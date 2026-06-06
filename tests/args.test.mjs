import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, splitRawArgumentString, normalizeArgv } from "../plugins/gemini/scripts/lib/args.mjs";
import { ConfigError } from "../plugins/gemini/scripts/lib/errors.mjs";

test("parses empty argv", () => {
  const { options, positionals } = parseArgs([]);
  assert.deepEqual(options, {});
  assert.deepEqual(positionals, []);
});

test("parses boolean flags", () => {
  const { options } = parseArgs(["--wait", "--background", "--json"]);
  assert.equal(options.wait, true);
  assert.equal(options.background, true);
  assert.equal(options.json, true);
});

test("parses value flags with space separator", () => {
  const { options } = parseArgs(["--base", "main", "--cwd", "/tmp/x"]);
  assert.equal(options.base, "main");
  assert.equal(options.cwd, "/tmp/x");
});

test("parses value flags with = separator", () => {
  const { options } = parseArgs(["--base=develop", "--cwd=/tmp/x"]);
  assert.equal(options.base, "develop");
  assert.equal(options.cwd, "/tmp/x");
});

test("rejects value flag without value", () => {
  assert.throws(() => parseArgs(["--base"]), ConfigError);
});

test("rejects value flag followed by another flag", () => {
  assert.throws(() => parseArgs(["--base", "--wait"]), ConfigError);
});

test("rejects boolean flag with =value", () => {
  assert.throws(() => parseArgs(["--wait=yes"]), ConfigError);
});

test("rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--foo"]), ConfigError);
});

test("--model is now an unknown flag (dropped in v0.1)", () => {
  assert.throws(
    () => parseArgs(["--model", "best"]),
    (err) => err instanceof ConfigError && /unknown flag.*--model/i.test(err.message)
  );
});

test("disallows positionals by default", () => {
  assert.throws(() => parseArgs(["some-focus", "--base", "main"]), ConfigError);
});

test("allows positionals when opted in", () => {
  const { options, positionals } = parseArgs(
    ["--base", "main", "challenge", "the", "design"],
    { allowPositionals: true }
  );
  assert.equal(options.base, "main");
  assert.deepEqual(positionals, ["challenge", "the", "design"]);
});

test("-- separator collects remaining as positionals", () => {
  const { options, positionals } = parseArgs(
    ["--wait", "--", "--not-a-flag", "text"],
    { allowPositionals: true }
  );
  assert.equal(options.wait, true);
  assert.deepEqual(positionals, ["--not-a-flag", "text"]);
});

test("splitRawArgumentString handles plain tokens", () => {
  assert.deepEqual(splitRawArgumentString("--base main --cwd /tmp/x"), [
    "--base",
    "main",
    "--cwd",
    "/tmp/x"
  ]);
});

test("splitRawArgumentString preserves quoted strings with spaces", () => {
  assert.deepEqual(
    splitRawArgumentString('--base main "focus on auth" extra'),
    ["--base", "main", "focus on auth", "extra"]
  );
});

test("splitRawArgumentString handles single quotes and escapes", () => {
  assert.deepEqual(
    splitRawArgumentString(`--base main 'don\\'t ship' `),
    ["--base", "main", "don't ship"]
  );
});

test("normalizeArgv: single joined string gets split", () => {
  assert.deepEqual(normalizeArgv(["--wait --base main"]), ["--wait", "--base", "main"]);
});

test("normalizeArgv: multi-element argv passes through", () => {
  assert.deepEqual(normalizeArgv(["--wait", "--base", "main"]), ["--wait", "--base", "main"]);
});

test("normalizeArgv: empty or whitespace returns empty", () => {
  assert.deepEqual(normalizeArgv([""]), []);
  assert.deepEqual(normalizeArgv(["   "]), []);
});
