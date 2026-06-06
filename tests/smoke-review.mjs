#!/usr/bin/env node
/**
 * E2E smoke test for /gemini:review. Requires:
 *   - Antigravity CLI (`agy`) on PATH
 *   - Working agy sign-in (run `agy -p hello` once interactively to OAuth)
 *
 * Pipes a short synthetic "assistant response" to the review subcommand and
 * verifies the agent returns a structured response with at least one
 * non-supported verdict (we seed a known-false claim so the reviewer should
 * flag it) AND at least one claim cites a source URL. Tool-call observability
 * is not available with `agy --print`, so we rely on claim sources rather than
 * tool-call counts as the grounding signal.
 *
 * Usage: node tests/smoke-review.mjs
 */

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(HERE, "..", "plugins", "gemini", "scripts", "gemini-companion.mjs");

const SYNTHETIC_RESPONSE = [
  "Here's what I know:",
  "- Redis uses AP consistency per the CAP theorem.",
  "- The JavaScript JSON.parse function throws SyntaxError on invalid input.",
  "- Node.js 25 ships a native HTTP/3 client built in.",
  "- The Riemann hypothesis was proven in 2024 by Terence Tao.",
  "Those four facts should answer your question."
].join("\n");

async function main() {
  console.log("=== /gemini:review smoke test (agy --print) ===\n");
  const started = Date.now();
  const result = spawnSync(
    process.execPath,
    [COMPANION, "review", "--json"],
    { encoding: "utf8", timeout: 600_000, input: SYNTHETIC_RESPONSE }
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (result.status !== 0) {
    console.error(`companion failed (${elapsed}s). stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    process.exit(1);
  }

  const payload = JSON.parse(result.stdout);
  console.log(`completed in ${elapsed}s`);
  console.log(`  stopReason: ${payload.stopReason}`);
  console.log(`  input bytes: ${payload.target.inputBytes}`);

  if (payload.parseError) {
    console.error(`  PARSE ERROR: ${payload.parseError}`);
    console.error(`  raw:\n${payload.rawOutput}`);
    process.exit(1);
  }

  const parsed = payload.parsed;
  if (!parsed || typeof parsed.overall !== "string") {
    console.error("  missing overall in parsed output");
    process.exit(1);
  }
  if (!Array.isArray(parsed.claims)) {
    console.error("  claims is not an array");
    process.exit(1);
  }

  console.log(`  overall: ${parsed.overall}`);
  console.log(`  summary: ${parsed.summary}`);
  console.log(`  claims: ${parsed.claims.length}`);
  for (const c of parsed.claims) {
    const correction = c.correction ? ` (→ ${c.correction})` : "";
    const sources = Array.isArray(c.sources) && c.sources.length ? ` [${c.sources.length} source${c.sources.length === 1 ? "" : "s"}]` : "";
    console.log(`    [${c.verdict}] ${c.claim}${correction}${sources}`);
  }
  console.log(`  reasoning_issues: ${parsed.reasoning_issues.length}`);
  for (const r of parsed.reasoning_issues) {
    console.log(`    - ${r.issue}: ${r.explanation}`);
  }

  const hasNonSupported = parsed.claims.some(
    (c) => c.verdict === "contradicted" || c.verdict === "uncertain"
  );
  if (!hasNonSupported) {
    console.error("  EXPECTED at least one contradicted or uncertain verdict; got all supported.");
    process.exit(1);
  }
  if (parsed.overall === "trustworthy") {
    console.error("  EXPECTED overall to be 'mixed' or 'problematic' given the seeded false claim.");
    process.exit(1);
  }

  const claimsWithSources = parsed.claims.filter(
    (c) => Array.isArray(c.sources) && c.sources.length > 0
  );
  if (claimsWithSources.length === 0) {
    console.error("  EXPECTED at least one claim with a source URL; got none.");
    console.error("  Grounding signal is missing: verify agy --print autonomously runs web search.");
    process.exit(1);
  }

  console.log(`\n  claims with sources: ${claimsWithSources.length} / ${parsed.claims.length}`);
  console.log("\nSMOKE TEST PASSED");
}

main().catch((err) => {
  console.error(`smoke test failed: ${err.message}`);
  process.exit(1);
});
