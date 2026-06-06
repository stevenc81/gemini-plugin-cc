#!/usr/bin/env node
/**
 * Deploy the local plugin source into Claude Code's installed-plugin cache
 * WITHOUT bumping the version.
 *
 * Why this exists: this repo is registered as a `directory` marketplace, so the
 * plugin Claude Code actually runs is a version-keyed *copy* under
 * `~/.claude/plugins/cache/<marketplace>/gemini/<version>/`, not the repo. The
 * normal way to ship a change is to bump the version (which creates a new cache
 * dir) and re-sync. This script instead copies the current source straight into
 * the existing install path, so the running version (e.g. 0.1.0) is updated in
 * place.
 *
 * Pickup semantics:
 *   - scripts/ are re-read by node on every `/gemini:review` and `/gemini:setup`
 *     invocation, so script changes take effect immediately, no reload needed.
 *   - command frontmatter and prompts/ are read by Claude Code when plugins load,
 *     so run `/reload-plugins` (or restart) after changing those.
 *
 * Usage: npm run deploy:local   (or: node sync-plugin-to-cache.mjs)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "plugins", "gemini");
const PLUGIN_KEY_PREFIX = "gemini@"; // gemini@<marketplace-name>

const installedPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
if (!fs.existsSync(installedPath)) {
  console.error(`No installed-plugins registry at ${installedPath}. Is the plugin installed?`);
  process.exit(1);
}

const installed = JSON.parse(fs.readFileSync(installedPath, "utf8"));
const key = Object.keys(installed.plugins ?? {}).find((k) => k.startsWith(PLUGIN_KEY_PREFIX));
if (!key) {
  console.error(`No installed plugin matching "${PLUGIN_KEY_PREFIX}*" in ${installedPath}.`);
  process.exit(1);
}

const entry = (installed.plugins[key] ?? [])[0];
const dest = entry?.installPath;
if (!dest) {
  console.error(`No installPath recorded for ${key} in ${installedPath}.`);
  process.exit(1);
}

fs.cpSync(SRC, dest, { recursive: true, force: true });

console.log(`Deployed plugin source into the installed cache (no version bump):`);
console.log(`  from: ${SRC}`);
console.log(`  to:   ${dest}`);
console.log(`  plugin: ${key} (version ${entry.version}, unchanged)`);
console.log(`Script changes are live on the next /gemini:review.`);
console.log(`Run /reload-plugins if you changed command frontmatter or prompts.`);
