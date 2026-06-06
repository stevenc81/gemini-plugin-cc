#!/usr/bin/env node
/**
 * Batch E2E smoke test for /gemini:review. Requires a working `agy` sign-in.
 *
 * Runs N distinct reviews through the real companion (each spawns `agy` in an
 * isolated temp cwd) and verifies that for every one, agy actually returned a
 * usable Gemini review response: exit 0, parsed JSON present (parseError null),
 * with a string `overall` and a non-empty `claims` array. Records the model
 * each run used (Gemini 3.1 Pro (High), or a Gemini 3.5 Flash (High) fallback).
 *
 * Usage: node tests/smoke-review-batch.mjs
 */
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(HERE, "..", "plugins", "gemini", "scripts", "gemini-companion.mjs");

const INPUTS = [
  "Redis is an AP system under the CAP theorem. Also, JSON.parse throws a SyntaxError on invalid input.",
  "The 2024 Nobel Prize in Physics was awarded to John Hopfield and Geoffrey Hinton for neural networks.",
  "Mount Everest is the tallest mountain above sea level, and K2 is the second tallest.",
  "Python 2 reached its official end-of-life on January 1, 2020.",
  "The HTTP status code 418 means 'I'm a teapot', defined as an April Fools' joke in RFC 2324.",
  "Light travels faster in a vacuum than in water. The speed of light in vacuum is about 299,792 km/s.",
  "Git was created by Linus Torvalds in 2005 to manage Linux kernel development.",
  "The capital of Australia is Canberra, not Sydney or Melbourne.",
  "TypeScript is a statically typed superset of JavaScript developed by Microsoft.",
  "The Great Wall of China is visible from low Earth orbit with the naked eye."
];

const CONCURRENCY = 4;
const PER_CALL_TIMEOUT_MS = 120_000; // agy --print-timeout for the primary model
const KILL_MS = 270_000; // hard kill (allows a primary timeout + fallback to finish)

function runOne(index, input) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [COMPANION, "review", "--json"], {
      env: { ...process.env, GEMINI_PLUGIN_CC_PROMPT_TIMEOUT_MS: String(PER_CALL_TIMEOUT_MS) },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, KILL_MS);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      clearTimeout(timer);
      const elapsedS = ((Date.now() - started) / 1000).toFixed(1);
      let payload = null;
      let jsonErr = null;
      try {
        payload = JSON.parse(stdout);
      } catch (e) {
        jsonErr = e.message;
      }
      const parsed = payload?.parsed ?? null;
      const ok =
        code === 0 &&
        !killed &&
        parsed &&
        typeof parsed.overall === "string" &&
        Array.isArray(parsed.claims) &&
        parsed.claims.length > 0;
      const sources = Array.isArray(parsed?.claims)
        ? parsed.claims.reduce((n, c) => n + (Array.isArray(c.sources) ? c.sources.length : 0), 0)
        : 0;
      resolve({
        index,
        ok,
        code,
        killed,
        elapsedS,
        model: payload?.model ?? null,
        fellBack: payload?.fellBack ?? null,
        overall: parsed?.overall ?? null,
        claims: Array.isArray(parsed?.claims) ? parsed.claims.length : 0,
        sources,
        parseError: payload?.parseError ?? jsonErr,
        stderr: ok ? "" : stderr.trim().slice(0, 200)
      });
    });
    child.stdin.end(input);
  });
}

async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const r = await fn(i, items[i]);
      results[i] = r;
      const tag = r.ok ? "PASS" : "FAIL";
      const fb = r.fellBack ? " (fellBack)" : "";
      const extra = r.ok ? "" : `  <- ${r.parseError || r.stderr || (r.killed ? "killed (timeout)" : "exit " + r.code)}`;
      console.log(
        `[${String(r.index + 1).padStart(2)}/${items.length}] ${tag}  ${String(r.elapsedS).padStart(5)}s  model=${r.model ?? "?"}${fb}  overall=${r.overall ?? "-"}  claims=${r.claims}  sources=${r.sources}${extra}`
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const started = Date.now();
console.log(`=== Gemini review batch smoke: ${INPUTS.length} live reviews via agy (concurrency ${CONCURRENCY}) ===\n`);
const results = await pool(INPUTS, CONCURRENCY, runOne);
const passed = results.filter((r) => r.ok).length;
const totalS = ((Date.now() - started) / 1000).toFixed(1);

const modelCounts = {};
for (const r of results) {
  const key = (r.model ?? "?") + (r.fellBack ? " (fallback)" : "");
  modelCounts[key] = (modelCounts[key] || 0) + 1;
}

console.log(`\n=== ${passed}/${results.length} returned a usable Gemini review response  (${totalS}s total) ===`);
console.log(`models used: ${JSON.stringify(modelCounts)}`);
process.exit(passed === results.length ? 0 : 1);
