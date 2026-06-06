import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  handleSetup,
  setRunReviewForTest,
  setBinaryAvailableForTest
} from "../plugins/gemini/scripts/gemini-companion.mjs";

function captureStdout(fn) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    return true;
  };
  return fn()
    .finally(() => {
      process.stdout.write = orig;
    })
    .then(() => chunks.join(""));
}

beforeEach(() => {
  setRunReviewForTest(null);
  setBinaryAvailableForTest(null);
});
afterEach(() => {
  setRunReviewForTest(null);
  setBinaryAvailableForTest(null);
});

test("setup auth line reports the detected agy version, not a hardcoded one", async () => {
  // Inject both the binary probe and the round-trip so the test is deterministic
  // and runs without a real `agy` install.
  setBinaryAvailableForTest(() => ({ available: true, detail: "9.9.9-test" }));
  setRunReviewForTest(async () => ({
    stopReason: "end_turn",
    text: "OK",
    model: null,
    tokens: null,
    agentVersion: "9.9.9-test",
    toolCalls: []
  }));

  const out = await captureStdout(() => handleSetup([]));

  const authLine = out.split("\n").find((l) => l.startsWith("Auth check:"));
  assert.ok(authLine, "expected an 'Auth check:' line in the setup report");
  assert.match(authLine, /9\.9\.9-test/); // detected version flows into the auth line
  assert.doesNotMatch(out, /1\.0\.0/); // no stale hardcoded version anywhere in the report
});
