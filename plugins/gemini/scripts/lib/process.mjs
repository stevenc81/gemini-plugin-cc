import { spawnSync } from "node:child_process";

export function runCommand(cmd, args, { cwd = process.cwd(), timeoutMs = 15000, env = process.env } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
    signal: result.signal,
    error: result.error ?? null
  };
}

export function binaryAvailable(cmd, versionArgs = ["--version"], options = {}) {
  const result = runCommand(cmd, versionArgs, { timeoutMs: 5000, ...options });
  if (result.error && result.error.code === "ENOENT") {
    return { available: false, detail: `${cmd} not found on PATH` };
  }
  if (result.status !== 0) {
    return { available: false, detail: `${cmd} ${versionArgs.join(" ")} exited with status ${result.status}` };
  }
  const firstLine = result.stdout.split(/\r?\n/, 1)[0].trim() || `${cmd} ok`;
  return { available: true, detail: firstLine };
}
