import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStructuredOutput,
  parseReviewOutput,
  internals
} from "../plugins/gemini/scripts/lib/output-parser.mjs";

const valid = {
  overall: "mixed",
  summary: "Mostly sound, one unsupported claim.",
  claims: [
    {
      claim: "Redis is AP per CAP theorem.",
      verdict: "contradicted",
      reasoning: "Redis is typically classified as CP.",
      correction: "Redis defaults to CP in master-replica configurations with consistent replication.",
      sources: ["https://redis.io/docs/latest/operate/oss_and_stack/management/replication/"]
    },
    {
      claim: "JSON.parse throws SyntaxError on invalid input.",
      verdict: "supported",
      reasoning: "This matches the JavaScript language spec.",
      sources: ["https://tc39.es/ecma262/#sec-json.parse"]
    }
  ],
  reasoning_issues: [
    {
      issue: "Unstated assumption about default config.",
      explanation: "The claim about Redis assumes the default config without stating it."
    }
  ]
};

test("parses valid review output (bare JSON)", () => {
  const r = parseReviewOutput(JSON.stringify(valid));
  assert.equal(r.parseError, null);
  assert.equal(r.parsed.overall, "mixed");
  assert.equal(r.parsed.claims.length, 2);
  assert.equal(r.parsed.claims[0].verdict, "contradicted");
  assert.deepEqual(r.parsed.claims[0].sources, [
    "https://redis.io/docs/latest/operate/oss_and_stack/management/replication/"
  ]);
});

test("parses fenced review output", () => {
  const r = parseReviewOutput("```json\n" + JSON.stringify(valid) + "\n```");
  assert.equal(r.parseError, null);
});

test("parses via parseStructuredOutput with review-output schema", () => {
  const r = parseStructuredOutput(JSON.stringify(valid), "review-output");
  assert.equal(r.parseError, null);
});

test("rejects invalid overall enum", () => {
  const bad = { ...valid, overall: "maybe" };
  const r = parseReviewOutput(JSON.stringify(bad));
  assert.match(r.parseError, /overall/);
});

test("rejects missing claims array", () => {
  const bad = { overall: "trustworthy", summary: "s", reasoning_issues: [] };
  const r = parseReviewOutput(JSON.stringify(bad));
  assert.match(r.parseError, /claims/);
});

test("rejects missing reasoning_issues", () => {
  const bad = { overall: "trustworthy", summary: "s", claims: [] };
  const r = parseReviewOutput(JSON.stringify(bad));
  assert.match(r.parseError, /reasoning_issues/);
});

test("rejects invalid claim verdict enum", () => {
  const bad = {
    ...valid,
    claims: [{ claim: "x", verdict: "possibly", reasoning: "r" }]
  };
  const r = parseReviewOutput(JSON.stringify(bad));
  assert.match(r.parseError, /verdict/);
});

test("rejects claim with extra property", () => {
  const bad = {
    ...valid,
    claims: [{ claim: "x", verdict: "supported", reasoning: "r", confidence: 0.5 }]
  };
  const r = parseReviewOutput(JSON.stringify(bad));
  assert.match(r.parseError, /confidence/);
});

test("accepts claim without correction when verdict != contradicted", () => {
  const ok = {
    overall: "trustworthy",
    summary: "ok",
    claims: [{ claim: "x", verdict: "supported", reasoning: "r" }],
    reasoning_issues: []
  };
  const r = parseReviewOutput(JSON.stringify(ok));
  assert.equal(r.parseError, null);
});

test("accepts claim without sources (field is optional)", () => {
  const ok = {
    overall: "mixed",
    summary: "s",
    claims: [{ claim: "x", verdict: "uncertain", reasoning: "r" }],
    reasoning_issues: []
  };
  const r = parseReviewOutput(JSON.stringify(ok));
  assert.equal(r.parseError, null);
});

test("accepts claim with sources: []", () => {
  const ok = {
    overall: "mixed",
    summary: "s",
    claims: [{ claim: "x", verdict: "uncertain", reasoning: "r", sources: [] }],
    reasoning_issues: []
  };
  const r = parseReviewOutput(JSON.stringify(ok));
  assert.equal(r.parseError, null);
});

test("rejects non-string entries in sources", () => {
  const bad = {
    overall: "mixed",
    summary: "s",
    claims: [{ claim: "x", verdict: "supported", reasoning: "r", sources: [123] }],
    reasoning_issues: []
  };
  const r = parseReviewOutput(JSON.stringify(bad));
  assert.match(r.parseError, /string/);
});

test("accepts empty claims and issues arrays", () => {
  const empty = {
    overall: "trustworthy",
    summary: "No material claims to review.",
    claims: [],
    reasoning_issues: []
  };
  const r = parseReviewOutput(JSON.stringify(empty));
  assert.equal(r.parseError, null);
});

test("rejects extra top-level property", () => {
  const bad = { ...valid, extra: true };
  const r = parseReviewOutput(JSON.stringify(bad));
  assert.match(r.parseError, /extra/);
});

test("reports JSON parse failure", () => {
  const r = parseReviewOutput("{not valid json");
  assert.equal(r.parsed, null);
  assert.match(r.parseError, /JSON parse failed/);
});

test("reports empty output", () => {
  const r = parseReviewOutput("");
  assert.equal(r.parsed, null);
  assert.match(r.parseError, /Empty/);
});

test("stripFences leaves bare JSON intact", () => {
  assert.equal(internals.stripFences("{}"), "{}");
});

test("stripFences handles json tag", () => {
  assert.equal(internals.stripFences("```json\n{}\n```"), "{}");
});

test("stripFences handles bare backticks", () => {
  assert.equal(internals.stripFences("```\n{}\n```"), "{}");
});
