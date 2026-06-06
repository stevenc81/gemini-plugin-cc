import { spawn as nodeSpawn } from "node:child_process";
import process from "node:process";
import { AgyAuthError, AgyConnectionError, AgyTimeoutError } from "./errors.mjs";

const DEFAULT_PROMPT_TIMEOUT_MS = 600_000;
const SIGKILL_GRACE_MS = 1500;

function secondsForGoDuration(ms) {
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
}

function isAuthMessage(text) {
  const t = String(text ?? "").toLowerCase();
  return (
    t.includes("not signed in") ||
    t.includes("sign in") ||
    t.includes("unauthorized") ||
    t.includes("login") ||
    t.includes("authenticate")
  );
}

/**
 * Run a single prompt against the Antigravity CLI (`agy --print`) and return
 * the captured stdout. When `model` is set it is passed through as
 * `agy --model <model>` and echoed back on the result; otherwise `agy` uses its
 * default model and the returned `model` is `null`. `tokens` is always `null`
 * and `toolCalls` is empty because `agy --print` surfaces neither usage nor
 * tool-call events.
 */
export function runReview({
  prompt,
  cwd = process.cwd(),
  promptTimeoutMs = DEFAULT_PROMPT_TIMEOUT_MS,
  agentVersion = null,
  model = null,
  spawnFn = nodeSpawn,
  onProgress: _onProgress = null
} = {}) {
  if (!prompt) {
    throw new AgyConnectionError("runReview requires a non-empty prompt.");
  }

  const args = [];
  if (model) args.push("--model", model);
  args.push("--print", "--print-timeout", secondsForGoDuration(promptTimeoutMs));
  const proc = spawnFn("agy", args, { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  return new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    proc.stdout?.setEncoding?.("utf8");
    proc.stderr?.setEncoding?.("utf8");

    proc.stdout?.on("data", (chunk) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    proc.stderr?.on("data", (chunk) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    const finishWith = (cb) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallTimer);
      cb();
    };

    const wallTimer = setTimeout(() => {
      finishWith(() => {
        try {
          proc.kill?.("SIGTERM");
        } catch {
          /* already gone */
        }
        const killTimer = setTimeout(() => {
          try {
            proc.kill?.("SIGKILL");
          } catch {
            /* already gone */
          }
        }, SIGKILL_GRACE_MS);
        killTimer.unref?.();
        reject(
          new AgyTimeoutError(
            `agy --print exceeded wall-clock budget of ${promptTimeoutMs}ms.`,
            {
              suggestion:
                "Retry. For consistently large prompts, raise GEMINI_PLUGIN_CC_PROMPT_TIMEOUT_MS."
            }
          )
        );
      });
    }, promptTimeoutMs);
    wallTimer.unref?.();

    proc.on?.("error", (err) => {
      finishWith(() => {
        if (err?.code === "ENOENT") {
          reject(
            new AgyConnectionError(
              "agy binary not found on PATH.",
              {
                suggestion:
                  "Install Antigravity CLI from https://antigravity.google then run `agy --version`.",
                cause: err
              }
            )
          );
          return;
        }
        reject(
          new AgyConnectionError(`failed to spawn agy: ${err?.message ?? String(err)}`, {
            cause: err
          })
        );
      });
    });

    proc.on?.("exit", (code, signal) => {
      finishWith(() => {
        if (code === 0) {
          resolve({
            stopReason: "end_turn",
            text: stdout,
            model: model ?? null,
            tokens: null,
            agentVersion,
            toolCalls: []
          });
          return;
        }
        const detail = stderr.trim() || stdout.trim() || `exit ${code ?? signal}`;
        if (isAuthMessage(detail)) {
          reject(
            new AgyAuthError(`agy is not signed in: ${detail}`, {
              suggestion:
                "Run `agy --print -p 'hello'` once interactively to complete OAuth, then retry."
            })
          );
          return;
        }
        reject(
          new AgyConnectionError(`agy --print failed (${code ?? signal}): ${detail}`, {
            suggestion:
              "Verify `agy --version` works and you are signed in. Rerun with GEMINI_PLUGIN_CC_DEBUG=1 for details."
          })
        );
      });
    });

    try {
      proc.stdin?.end(prompt);
    } catch (err) {
      finishWith(() => {
        reject(
          new AgyConnectionError(`failed to write prompt to agy stdin: ${err?.message ?? err}`, {
            cause: err
          })
        );
      });
    }
  });
}
