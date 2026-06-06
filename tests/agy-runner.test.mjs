import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { runReview } from "../plugins/gemini/scripts/lib/agy-runner.mjs";
import {
  AgyAuthError,
  AgyConnectionError,
  AgyTimeoutError
} from "../plugins/gemini/scripts/lib/errors.mjs";

function makeFakeProc({ stdoutChunks = [], stderrChunks = [], exitCode = 0, exitDelayMs = 5, captureStdin = null } = {}) {
  const proc = new EventEmitter();
  const stdinWrites = [];
  proc.stdin = new Writable({
    write(chunk, _enc, cb) {
      stdinWrites.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
      cb();
    },
    final(cb) {
      if (captureStdin) captureStdin(stdinWrites.join(""));
      cb();
    }
  });
  proc.stdout = Readable.from(stdoutChunks);
  proc.stderr = Readable.from(stderrChunks);
  proc.kill = (sig) => {
    proc._killedWith = sig;
    setTimeout(() => proc.emit("exit", null, sig ?? "SIGTERM"), 1);
    return true;
  };
  setTimeout(() => proc.emit("exit", exitCode, null), exitDelayMs);
  return { proc, getStdin: () => stdinWrites.join("") };
}

test("spawns agy --print with the configured cwd and writes prompt to stdin", async () => {
  let spawnArgs;
  let captured;
  const { proc } = makeFakeProc({
    stdoutChunks: ["hello back\n"],
    captureStdin: (s) => (captured = s)
  });
  const spawnFn = (cmd, args, opts) => {
    spawnArgs = { cmd, args, opts };
    return proc;
  };
  const result = await runReview({
    prompt: "ping",
    cwd: "/tmp/xyz",
    spawnFn,
    promptTimeoutMs: 60_000
  });
  assert.equal(spawnArgs.cmd, "agy");
  assert.deepEqual(spawnArgs.args, ["--print", "--print-timeout", "60s"]);
  assert.equal(spawnArgs.opts.cwd, "/tmp/xyz");
  assert.equal(captured, "ping");
  assert.equal(result.text, "hello back\n");
  assert.equal(result.stopReason, "end_turn");
  assert.deepEqual(result.toolCalls, []);
  // agy --print exposes no runtime model, so the runner always returns null.
  assert.equal(result.model, null);
  assert.equal(result.tokens, null);
});

test("rounds prompt-timeout up to the nearest second for agy's Go duration", async () => {
  let captured;
  const { proc } = makeFakeProc({ stdoutChunks: ["k\n"] });
  await runReview({
    prompt: "x",
    promptTimeoutMs: 1500,
    spawnFn: (_cmd, args) => {
      captured = args;
      return proc;
    }
  });
  // 1500ms -> 2s after ceil
  assert.deepEqual(captured, ["--print", "--print-timeout", "2s"]);
});

test("nonzero exit throws AgyConnectionError with stderr in the message", async () => {
  const { proc } = makeFakeProc({
    stdoutChunks: [""],
    stderrChunks: ["transient backend error: 503\n"],
    exitCode: 1
  });
  await assert.rejects(
    () => runReview({ prompt: "x", spawnFn: () => proc }),
    (err) => err instanceof AgyConnectionError && /503/.test(err.message)
  );
});

test("nonzero exit with auth-shaped stderr throws AgyAuthError", async () => {
  const { proc } = makeFakeProc({
    stdoutChunks: [""],
    stderrChunks: ["fatal: not signed in\n"],
    exitCode: 1
  });
  await assert.rejects(
    () => runReview({ prompt: "x", spawnFn: () => proc }),
    (err) => err instanceof AgyAuthError && /not signed in/.test(err.message)
  );
});

test("ENOENT on spawn throws AgyConnectionError suggesting agy install", async () => {
  const proc = new EventEmitter();
  proc.stdin = new Writable({ write: (_c, _e, cb) => cb() });
  proc.stdout = Readable.from([]);
  proc.stderr = Readable.from([]);
  proc.kill = () => true;
  setTimeout(() => {
    const err = new Error("spawn agy ENOENT");
    err.code = "ENOENT";
    proc.emit("error", err);
  }, 1);
  await assert.rejects(
    () => runReview({ prompt: "x", spawnFn: () => proc }),
    (err) => err instanceof AgyConnectionError && /agy/i.test(err.message)
  );
});

test("wall-clock timeout kills the process and throws AgyTimeoutError", async () => {
  const proc = new EventEmitter();
  let killed;
  proc.stdin = new Writable({ write: (_c, _e, cb) => cb() });
  proc.stdout = Readable.from([]);
  proc.stderr = Readable.from([]);
  proc.kill = (sig) => {
    killed = sig;
    setTimeout(() => proc.emit("exit", null, sig), 1);
    return true;
  };
  await assert.rejects(
    () => runReview({ prompt: "x", spawnFn: () => proc, promptTimeoutMs: 50 }),
    (err) => err instanceof AgyTimeoutError
  );
  assert.ok(killed === "SIGTERM" || killed === "SIGKILL");
});

test("concatenates multiple stdout chunks into a single text", async () => {
  const { proc } = makeFakeProc({ stdoutChunks: ["part-1 ", "part-2 ", "part-3"] });
  const result = await runReview({ prompt: "x", spawnFn: () => proc });
  assert.equal(result.text, "part-1 part-2 part-3");
});

test("agentVersion is read from binary detail when provided", async () => {
  const { proc } = makeFakeProc({ stdoutChunks: ["ok\n"] });
  const result = await runReview({
    prompt: "x",
    agentVersion: "1.0.0",
    spawnFn: () => proc
  });
  assert.equal(result.agentVersion, "1.0.0");
});

test("missing prompt throws synchronously", () => {
  assert.throws(() => runReview({ prompt: "", spawnFn: () => null }));
});

test("passes --model before --print when a model is given and echoes it back", async () => {
  let capturedArgs;
  const { proc } = makeFakeProc({ stdoutChunks: ["ok\n"] });
  const result = await runReview({
    prompt: "x",
    model: "Gemini 3.1 Pro (High)",
    promptTimeoutMs: 60_000,
    spawnFn: (_cmd, args) => {
      capturedArgs = args;
      return proc;
    }
  });
  assert.deepEqual(capturedArgs, [
    "--model",
    "Gemini 3.1 Pro (High)",
    "--print",
    "--print-timeout",
    "60s"
  ]);
  assert.equal(result.model, "Gemini 3.1 Pro (High)");
});
