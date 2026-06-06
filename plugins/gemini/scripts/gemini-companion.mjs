#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { parseArgs, normalizeArgv } from "./lib/args.mjs";
import { binaryAvailable as realBinaryAvailable } from "./lib/process.mjs";
import { renderPrompt } from "./lib/prompts.mjs";
import { runReview as realRunReview } from "./lib/agy-runner.mjs";
import { parseReviewOutput } from "./lib/output-parser.mjs";
import { renderReviewResult, renderSetupReport, renderError } from "./lib/render.mjs";
import { resolveSources } from "./lib/source-resolver.mjs";
import { truncateOnLineBoundary, byteLength } from "./lib/text-utils.mjs";
import {
  ConfigError,
  AgyAuthError,
  AgyConnectionError
} from "./lib/errors.mjs";

const MAX_REVIEW_INPUT_BYTES = 40_000;

// Model policy for /gemini:review: prefer Gemini 3.1 Pro (High); if that run
// fails for any reason other than auth, retry once with Gemini 3.5 Flash (High).
// These strings are the exact display names that `agy --model` accepts.
const PRIMARY_REVIEW_MODEL = "Gemini 3.1 Pro (High)";
const FALLBACK_REVIEW_MODEL = "Gemini 3.5 Flash (High)";

let runReviewImpl = realRunReview;
/** Test-only hook: swap the transport so unit tests don't spawn agy. */
export function setRunReviewForTest(fn) {
  runReviewImpl = fn ?? realRunReview;
}

let binaryAvailableImpl = realBinaryAvailable;
/** Test-only hook: swap the binary probe so unit tests don't spawn agy. */
export function setBinaryAvailableForTest(fn) {
  binaryAvailableImpl = fn ?? realBinaryAvailable;
}

function resolveCwd(options) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function envInt(name, fallback) {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readAllStdinSync() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (err) {
    if (err?.code === "EAGAIN") return "";
    throw err;
  }
}

function makeNeutralReviewCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemini-review-cwd-"));
}

function removeNeutralReviewCwd(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup failures */
  }
}

export async function handleReview(argv, { stdin = null } = {}) {
  const { options, positionals } = parseArgs(normalizeArgv(argv), { allowPositionals: true });

  const rawInput = (stdin != null ? stdin : readAllStdinSync()) ?? "";
  if (!rawInput.trim()) {
    throw new ConfigError("No content received on stdin to review.", {
      suggestion: "/gemini:review reads the content to audit from stdin. Pipe in the text you want reviewed and rerun."
    });
  }

  const originalBytes = byteLength(rawInput);
  const truncationResult = truncateOnLineBoundary(rawInput, MAX_REVIEW_INPUT_BYTES);
  const content = truncationResult.content;
  const truncated = truncationResult.truncated;
  const omittedBytes = truncationResult.omittedBytes;

  const focus = positionals.join(" ").trim();

  const { text: prompt } = renderPrompt("review", {
    CONTENT: content,
    USER_FOCUS: focus || "No specific focus provided."
  });

  // Evaluate the text in isolation: create an empty temp directory and use
  // that as the working directory so the agent has no repo to wander into
  // when assessing claims. The --cwd option is accepted for testing overrides.
  const neutralCwd = options.cwd
    ? path.resolve(process.cwd(), options.cwd)
    : makeNeutralReviewCwd();
  const shouldCleanupCwd = !options.cwd;

  const agyVersion = binaryAvailableImpl("agy", ["--version"], { cwd: neutralCwd }).detail;

  const runArgs = {
    prompt,
    cwd: neutralCwd,
    agentVersion: agyVersion,
    promptTimeoutMs: envInt("GEMINI_PLUGIN_CC_PROMPT_TIMEOUT_MS", undefined)
  };

  let result;
  let usedModel = PRIMARY_REVIEW_MODEL;
  let fellBack = false;
  try {
    try {
      result = await runReviewImpl({ ...runArgs, model: PRIMARY_REVIEW_MODEL });
    } catch (err) {
      // A different model won't fix an auth problem, so surface that directly.
      if (err instanceof AgyAuthError) throw err;
      usedModel = FALLBACK_REVIEW_MODEL;
      fellBack = true;
      result = await runReviewImpl({ ...runArgs, model: FALLBACK_REVIEW_MODEL });
    }
  } finally {
    if (shouldCleanupCwd) removeNeutralReviewCwd(neutralCwd);
  }

  const parsed = parseReviewOutput(result.text);
  if (parsed.parsed) {
    await resolveSources(parsed.parsed, {
      enabled: process.env.GEMINI_PLUGIN_CC_RESOLVE_SOURCES !== "0",
      timeoutMs: envInt("GEMINI_PLUGIN_CC_RESOLVE_SOURCES_TIMEOUT_MS", 3000)
    });
  }
  const target = { mode: "review", inputBytes: originalBytes, truncated, omittedBytes };
  const toolCalls = result.toolCalls ?? [];

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          target,
          model: usedModel,
          requestedModel: PRIMARY_REVIEW_MODEL,
          fellBack,
          agentVersion: result.agentVersion,
          stopReason: result.stopReason,
          tokens: result.tokens,
          toolCalls,
          parsed: parsed.parsed,
          parseError: parsed.parseError,
          rawOutput: parsed.rawOutput
        },
        null,
        2
      ) + "\n"
    );
    return;
  }

  const rendered = renderReviewResult({
    ...parsed,
    target,
    tokens: result.tokens,
    agentVersion: result.agentVersion,
    model: usedModel,
    requestedModel: PRIMARY_REVIEW_MODEL,
    fellBack,
    toolCalls
  });
  process.stdout.write(rendered);
}

export async function handleSetup(argv) {
  const { options } = parseArgs(normalizeArgv(argv));
  const cwd = resolveCwd(options);

  const agy = binaryAvailableImpl("agy", ["--version"], { cwd });
  if (!agy.available) {
    const report = renderSetupReport({
      agy,
      nextSteps: [
        "Install Antigravity CLI. See https://antigravity.google for instructions."
      ]
    });
    process.stdout.write(report);
    process.exitCode = 1;
    return;
  }

  const started = Date.now();
  try {
    const result = await runReviewImpl({
      prompt: "Reply with the single word OK and nothing else.",
      cwd,
      promptTimeoutMs: 60_000,
      agentVersion: agy.detail
    });
    const roundTripMs = Date.now() - started;
    const version = result.agentVersion ?? agy.detail;
    const report = renderSetupReport({
      agy,
      version,
      transportOk: true,
      authOk: true,
      authDetail: `round-trip ok (agy ${version}, default model)`,
      roundTripMs,
      nextSteps: options.json ? [] : ["Ready. Try `/gemini:review`."]
    });
    if (options.json) {
      process.stdout.write(
        JSON.stringify(
          {
            agy,
            version,
            transportOk: true,
            authOk: true,
            roundTripMs
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(report);
    }
  } catch (err) {
    const transportOk = !(err instanceof AgyConnectionError);
    const authOk = !(err instanceof AgyAuthError);
    const nextSteps = [];
    if (err instanceof AgyAuthError) {
      nextSteps.push(
        "Run `agy -p hello` once interactively to complete OAuth, then retry `/gemini:setup`."
      );
    } else if (err instanceof AgyConnectionError) {
      nextSteps.push(
        "Verify `agy --version` works. If install is missing, see https://antigravity.google."
      );
    } else {
      nextSteps.push(
        `Unexpected error during setup: ${err.message}. Retry; rerun with GEMINI_PLUGIN_CC_DEBUG=1 for details.`
      );
    }
    const report = renderSetupReport({
      agy,
      transportOk,
      authOk,
      authDetail: err.message,
      nextSteps
    });
    process.stdout.write(report);
    process.exitCode = 1;
  }
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node scripts/gemini-companion.mjs setup [--json]",
      "  node scripts/gemini-companion.mjs review [--json] [focus text...]  (content to review read from stdin)",
      ""
    ].join("\n")
  );
}

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    printUsage();
    return;
  }
  switch (subcommand) {
    case "setup":
      await handleSetup(rest);
      return;
    case "review":
      await handleReview(rest);
      return;
    default:
      throw new ConfigError(`Unknown subcommand: ${subcommand}`, {
        suggestion: "Valid subcommands: setup, review."
      });
  }
}

const invokedDirectly = (() => {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(renderError(err));
    process.exitCode = 1;
  });
}
