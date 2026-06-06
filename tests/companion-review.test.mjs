import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { handleReview, setRunReviewForTest } from "../plugins/gemini/scripts/gemini-companion.mjs";
import { ConfigError, AgyAuthError, AgyConnectionError } from "../plugins/gemini/scripts/lib/errors.mjs";

function captureStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return true;
  };
  return fn().finally(() => {
    process.stdout.write = orig;
  }).then(() => chunks.join(""));
}

const okPayload = {
  stopReason: "end_turn",
  text: JSON.stringify({
    overall: "mixed",
    summary: "Mixed bag.",
    claims: [
      {
        claim: "Redis is AP per CAP theorem.",
        verdict: "contradicted",
        reasoning: "Redis is CP in common configs.",
        correction: "Redis defaults to CP with consistent replication.",
        sources: ["https://redis.io/docs/latest/operate/oss_and_stack/management/replication/"]
      },
      {
        claim: "JSON.parse throws SyntaxError.",
        verdict: "supported",
        reasoning: "Matches the language spec.",
        sources: ["https://tc39.es/ecma262/#sec-json.parse"]
      },
      {
        claim: "Node 25 ships a native HTTP/3 client.",
        verdict: "uncertain",
        reasoning: "Search returned nothing definitive."
      }
    ],
    reasoning_issues: []
  }),
  // agy --print exposes no runtime model, token usage, or tool calls.
  model: null,
  tokens: null,
  agentVersion: "1.0.0",
  toolCalls: []
};

beforeEach(() => {
  setRunReviewForTest(null);
});
afterEach(() => {
  setRunReviewForTest(null);
});

test("rejects empty stdin with a clear ConfigError", async () => {
  setRunReviewForTest(async () => {
    throw new Error("should not be called");
  });
  await assert.rejects(
    () => handleReview([], { stdin: "" }),
    (err) => err instanceof ConfigError && /no content received/i.test(err.message)
  );
});

test("rejects whitespace-only stdin", async () => {
  setRunReviewForTest(async () => {
    throw new Error("should not be called");
  });
  await assert.rejects(
    () => handleReview([], { stdin: "   \n\t  " }),
    ConfigError
  );
});

test("happy path: renders structured output with claims and sources, passes no modelId to runner", async () => {
  setRunReviewForTest(async (args) => {
    assert.match(args.prompt, /content_to_review/);
    assert.match(args.prompt, /Redis is AP/);
    assert.match(args.prompt, /google_web_search/);
    // The runner must not receive any modelId — agy 1.0.0 ignores model selection.
    assert.equal("modelId" in args, false);
    return okPayload;
  });
  const out = await captureStdout(() =>
    handleReview([], { stdin: "I believe Redis is AP per CAP theorem. Also JSON.parse throws SyntaxError." })
  );
  assert.match(out, /Gemini Review/);
  assert.match(out, /Overall: mixed/);
  assert.match(out, /\[contradicted\]/);
  assert.match(out, /\[supported\]/);
  assert.match(out, /\[uncertain\]/);
  assert.match(out, /sources:/);
  assert.match(out, /https:\/\/redis\.io/);
  assert.match(out, /\[grounding\] 2 source URLs cited/);
  assert.match(out, /agy --print/);
  // The hardcoded primary model is surfaced in the header.
  assert.match(out, /model: Gemini 3\.1 Pro \(High\)/);
});

test("grounding footer warns when no tool calls AND no claim sources", async () => {
  setRunReviewForTest(async () => ({
    ...okPayload,
    text: JSON.stringify({
      overall: "mixed",
      summary: "No sources.",
      claims: [
        { claim: "x", verdict: "uncertain", reasoning: "y" }
      ],
      reasoning_issues: []
    })
  }));
  const out = await captureStdout(() => handleReview([], { stdin: "claim body" }));
  assert.match(out, /No claim sources cited/);
  assert.match(out, /Treat results as ungrounded/);
});

test("--json mode emits stable payload with model selection fields", async () => {
  setRunReviewForTest(async (args) => ({ ...okPayload, model: args.model }));
  const out = await captureStdout(() =>
    handleReview(["--json"], { stdin: "some text with a claim" })
  );
  const payload = JSON.parse(out);
  assert.equal(payload.target.mode, "review");
  assert.equal(payload.target.truncated, false);
  assert.ok(typeof payload.target.inputBytes === "number");
  assert.equal(payload.stopReason, "end_turn");
  assert.equal(payload.parsed.overall, "mixed");
  assert.equal(payload.parseError, null);
  assert.deepEqual(payload.toolCalls, []);
  assert.equal(payload.model, "Gemini 3.1 Pro (High)");
  assert.equal(payload.requestedModel, "Gemini 3.1 Pro (High)");
  assert.equal(payload.fellBack, false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "downgraded"), false);
});

test("parse failure (degraded, text mode): label tagged degraded, raw reasoning preserved, no error lede", async () => {
  setRunReviewForTest(async () => ({
    ...okPayload,
    text: "I will now emit the JSON, but I never did. The claim is contradicted by the 2023 paper."
  }));
  const out = await captureStdout(() => handleReview([], { stdin: "x" }));
  assert.match(out, /review \([^)]*degraded[^)]*\)/);
  assert.match(out, /Raw output:/);
  assert.match(out, /The claim is contradicted by the 2023 paper/);
  assert.doesNotMatch(out.split("\n").slice(0, 4).join("\n"), /Could not parse structured output/);
});

test("parse failure (degraded, --json): parsed null, parseError set, rawOutput preserved", async () => {
  const reasoning = "I will now emit the JSON, but I never did. Contradicted by the 2023 paper.";
  setRunReviewForTest(async () => ({
    ...okPayload,
    text: reasoning
  }));
  const out = await captureStdout(() =>
    handleReview(["--json"], { stdin: "claim body" })
  );
  const payload = JSON.parse(out);
  assert.equal(payload.parsed, null);
  assert.ok(typeof payload.parseError === "string" && payload.parseError.length > 0);
  assert.equal(payload.rawOutput, reasoning);
});

test("parse failure (empty output): rendered message calls out the empty case without Raw output heading", async () => {
  setRunReviewForTest(async () => ({
    ...okPayload,
    text: ""
  }));
  const out = await captureStdout(() => handleReview([], { stdin: "x" }));
  assert.match(out, /review \([^)]*degraded[^)]*\)/);
  assert.match(out, /no usable output/i);
  assert.doesNotMatch(out, /Raw output:/);
});

test("positional arguments become focus text", async () => {
  setRunReviewForTest(async ({ prompt }) => {
    assert.match(prompt, /focus on security claims/);
    return okPayload;
  });
  await captureStdout(() =>
    handleReview(["focus", "on", "security", "claims"], { stdin: "claim body" })
  );
});

test("truncation is surfaced in both json target and rendered footer", async () => {
  setRunReviewForTest(async () => okPayload);
  const big = Array(5000).fill("this is a line of content about AI and facts.").join("\n");
  const out = await captureStdout(() =>
    handleReview(["--json"], { stdin: big })
  );
  const payload = JSON.parse(out);
  assert.equal(payload.target.truncated, true);
  assert.ok(payload.target.omittedBytes > 0);
});

test("truncation footer shown in rendered mode", async () => {
  setRunReviewForTest(async () => okPayload);
  const big = Array(5000).fill("another content line for truncation test.").join("\n");
  const out = await captureStdout(() => handleReview([], { stdin: big }));
  assert.match(out, /Input was truncated by/);
});

test("header shows agy version and no model line", async () => {
  setRunReviewForTest(async () => okPayload);
  const out = await captureStdout(() => handleReview([], { stdin: "claim body" }));
  assert.match(out, /agy 1\.0\.0/);
  // The plugin now selects the model, so the header names it.
  assert.match(out, /model: Gemini 3\.1 Pro \(High\)/);
  assert.doesNotMatch(out, /downgraded from/i);
});

test("rejects --model flag (no longer supported)", async () => {
  setRunReviewForTest(async () => okPayload);
  await assert.rejects(
    () =>
      handleReview(["--model", "best"], { stdin: "claim body" }),
    (err) => err instanceof ConfigError && /unknown flag.*--model/i.test(err.message)
  );
});

test("uses Gemini 3.1 Pro (High) as the primary model and surfaces it in the header", async () => {
  let usedModel;
  setRunReviewForTest(async (args) => {
    usedModel = args.model;
    return { ...okPayload, model: args.model };
  });
  const out = await captureStdout(() => handleReview([], { stdin: "a claim to check" }));
  assert.equal(usedModel, "Gemini 3.1 Pro (High)");
  assert.match(out, /model: Gemini 3\.1 Pro \(High\)/);
});

test("falls back to Gemini 3.5 Flash (High) when the primary model fails", async () => {
  const calls = [];
  setRunReviewForTest(async (args) => {
    calls.push(args.model);
    if (args.model === "Gemini 3.1 Pro (High)") {
      throw new AgyConnectionError("primary model unavailable");
    }
    return { ...okPayload, model: args.model };
  });
  const out = await captureStdout(() => handleReview([], { stdin: "a claim to check" }));
  assert.deepEqual(calls, ["Gemini 3.1 Pro (High)", "Gemini 3.5 Flash (High)"]);
  assert.match(out, /model: Gemini 3\.5 Flash \(High\)/);
  assert.match(out, /fell back from Gemini 3\.1 Pro \(High\)/);
});

test("does not fall back on an auth error; surfaces it after a single attempt", async () => {
  const calls = [];
  setRunReviewForTest(async (args) => {
    calls.push(args.model);
    throw new AgyAuthError("agy is not signed in");
  });
  await assert.rejects(
    () => handleReview([], { stdin: "a claim to check" }),
    (err) => err instanceof AgyAuthError
  );
  assert.deepEqual(calls, ["Gemini 3.1 Pro (High)"]);
});
