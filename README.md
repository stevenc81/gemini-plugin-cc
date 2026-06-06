# gemini-plugin-cc

Use the Antigravity CLI (`agy`) from inside Claude Code to fact-check with live web grounding. This plugin is for Claude Code users who want a second-opinion reviewer that goes to the live web (not just training data) to verify claims made in a conversation.

> **Heads up:** This plugin previously spawned `gemini --acp` and spoke ACP (JSON-RPC) over stdio. Google retired Gemini CLI for free/Pro/Ultra users on June 18, 2026 and replaced it with [Antigravity CLI](https://antigravity.google) (`agy`), built in Go. This plugin has been migrated to spawn `agy --print` and parse its stdout. The slash commands carry over. See [Migration notes](#migration-notes-gemini-cli--antigravity-cli) below.

## What you get

- `/gemini:review` produces a grounded fact-check of content from the current conversation. `agy` runs live web searches autonomously and returns structured findings: which claims are supported, uncertain, or contradicted, with source URLs.
- `/gemini:setup` verifies that `agy` is installed and signed in via a trivial round-trip prompt.

Scope is deliberately narrow. One command, one job: grounded fact-checking.

## Requirements

- **Antigravity CLI** installed (`agy --version` must work). See https://antigravity.google
- **Sign-in.** Run `agy -p hello` once interactively; the first call opens a browser for OAuth and writes the session under `~/.gemini/antigravity-cli/`
- **Node.js 18.18 or later**

## Install

### From the marketplace (once published)

```bash
/plugin marketplace add stevenc81/gemini-plugin-cc
/plugin install gemini@stevenc81-gemini
/reload-plugins
```

### For local development

```bash
/plugin install gemini --path /path/to/gemini-plugin-cc/plugins/gemini
/reload-plugins
```

Then run `/gemini:setup` to verify everything is working. It performs an end-to-end check: binary, transport, and auth via a trivial round-trip prompt.

## Usage

### `/gemini:review`

Fact-checks content from the current conversation with live web grounding. By default it reviews Claude's immediately previous response, but you can point it at any specific text from the conversation (an earlier reply, a paragraph you pasted, a specific bullet you call out). The agent searches the live web for every verifiable claim, classifies each as `supported` / `uncertain` / `contradicted`, and cites the source URLs it consulted.

```bash
/gemini:review
/gemini:review --wait
/gemini:review check the second paragraph above
/gemini:review focus on the version numbers
```

Anything after `/gemini:review` is plain natural language, not fixed syntax or reserved keywords. Claude reads it and uses it in one of two ways:

- To choose what gets reviewed. Phrases like `check the second paragraph above` or `review what I just pasted` point Claude at specific text from the conversation, instead of the default (its previous reply).
- To steer attention. Phrases like `focus on the version numbers` leave the content as-is and tell the agent to weight those claims most heavily. It still reports any other material issue it finds.

The example wording is illustrative. There are no topic modes or special terms, so write whatever describes the text you mean and the angle you care about.

Flags:
- `--wait` runs the review in the foreground and streams back when done.
- `--background` runs it as a background task; Claude Code notifies you when it finishes.

How it works:
- Claude selects the content to review from your message and the conversation context (defaulting to its previous turn when you don't specify), then pipes it to the companion via a quoted heredoc. No temp files, no copy-paste.
- The companion spawns `agy --print --print-timeout <N>s` with the content prepended by a grounded review prompt. `agy` autonomously runs web search and page fetch.
- Output is schema-validated JSON, rendered into a structured report. A `[grounding]` footer counts the source URLs cited per claim; tool-call observability is not available with `agy --print`, so we rely on claim sources as the grounding signal.
- Input is capped at 40KB; overly-long content is truncated on a line boundary and the truncation is surfaced in the output.

Limitations:
- Search quality is bounded by what the agent returns and what it chooses to fetch. Niche or paywalled sources may be missed. Treat `uncertain` results as "search didn't find it," not "it's wrong."
- Claude picks the content to review from context. For unambiguous selection, quote or paste the exact text you want audited.
- `agy --print` does not surface tool-call events the way `gemini --acp` did. The `[grounding]` footer counts cited source URLs rather than search/fetch invocations.
- **Model.** Reviews run on Gemini 3.1 Pro (High). If that run fails for any reason other than an auth error, the plugin retries once on Gemini 3.5 Flash (High). The model that produced the result is shown in the review header and in `--json` output (`model`, `requestedModel`, `fellBack`). The choice is fixed in the plugin; there is no user-facing `--model` flag.

Output contract (success, degraded, empty):

The agent does not always emit a JSON block that matches the schema. Thinking-heavy outputs sometimes stream reasoning prose and end the turn without the structured payload. The companion always preserves what `agy` actually sent, and callers can discriminate three states:

| State | `--json` fields | Text-mode label |
|-------|----------------|-----------------|
| Success | `parsed` is an object, `parseError` is `null` | `review (N bytes)` |
| Degraded | `parsed` is `null`, `parseError` is a string, `rawOutput` contains the reasoning | `review (N bytes, degraded)` with the raw text under a `Raw output:` heading |
| Empty | `parsed` is `null`, `parseError` is `"Empty output from model."`, `rawOutput` is empty | `review (N bytes, degraded)` with a "no usable output" line and no raw section |

The exit code is `0` on any of the three states: the CLI ran and produced output. A non-zero exit code means the plugin itself failed (spawn error, auth failure, timeout). Callers that need to branch on answer quality should read `parseError` and `rawOutput` from `--json` mode rather than relying on the exit code.

### `/gemini:setup`

```bash
/gemini:setup
/gemini:setup --json
```

Verifies the `agy` binary, the print transport, and auth. If anything fails, suggests a next step.

## Configuration

Environment variables:

| Variable | Default | Effect |
|----------|---------|--------|
| `GEMINI_PLUGIN_CC_PROMPT_TIMEOUT_MS` | 600000 | Wall-clock timeout for the `agy --print` call, translated to `--print-timeout <N>s`. Grounded reviews commonly run 2–6 minutes; the cap exists to detect a genuinely stuck run, not to bound expected runtime. |
| `GEMINI_PLUGIN_CC_DEBUG` | (unset) | When set to `1`, error renders include the underlying cause. |

## How it works

The plugin wraps **Antigravity CLI** (`agy`). For each review, it:

1. Spawns `agy --print --print-timeout <N>s` as a child process
2. Writes the prompt (containing the grounded-review template, the content to review, and the JSON output schema) to `agy`'s stdin
3. Reads `agy`'s stdout once the process exits
4. Validates the output against a JSON schema
5. Renders the findings with source URLs and a grounding-coverage footer

The agent autonomously decides when to run web searches; the plugin doesn't drive tool selection or stream tool events. This is a deliberate simplification from the previous ACP-based design.

## FAQ

### Does this use my OpenAI / Anthropic account?

No. It uses your Antigravity CLI installation and your Google sign-in.

### Can I still use Codex or Claude Code's own review?

Yes. This plugin is Antigravity-specific and runs independently of other plugins. Use whichever reviewer fits the task.

### Which model runs the review?

Gemini 3.1 Pro (High) by default. If that run fails for any reason other than an auth error, the plugin retries once on Gemini 3.5 Flash (High), and the report notes the fallback. The model that produced the result is shown in the review header and in the `--json` payload (`model`, `requestedModel`, `fellBack`).

The choice is fixed in the plugin and passed as `agy --model <name>`; there is no user-facing `--model` flag. `agy` 1.0.5 lists other models via `agy models` (Gemini 3.x, Claude Opus and Sonnet 4.6, GPT-OSS), but the plugin pins the two above.

### Why is a grounded review slow?

Each verifiable claim runs at least one web search, usually followed by a page fetch. Server-side reasoning compounds with that. A 4–5 claim grounded review typically takes 2–6 minutes end-to-end. Because `agy --print` does not stream progress, the wait is silent until the response lands.

### Does the search cost money?

Your `agy` sign-in governs billing. Google AI Pro/Ultra and free-tier accounts have their own quotas; enterprise accounts use their own license. See your Antigravity plan for details.

## Migration notes (Gemini CLI → Antigravity CLI)

On May 19, 2026 at Google I/O, Google announced that Gemini CLI was being retired for free/Pro/Ultra users on June 18, 2026 and replaced with Antigravity CLI (`agy`). This plugin migrated in response. What changed and what stayed:

- **Transport.** Now spawns `agy --print` and reads stdout. The previous ACP JSON-RPC handshake (`initialize`, `session/new`, `session/set_mode`, `session/set_model`, `session/prompt`, `session/cancel`, `session/update`) is gone; `agy` does not expose ACP.
- **Plan mode.** Removed. `agy --print` operates on stdin only with no exposed cwd, so the read-only-ness comes from the transport itself rather than a session mode flag.
- **Tool-call observability.** Lost. `agy --print` does not surface tool-call events. The `[grounding]` footer now counts cited source URLs rather than search/fetch invocations.
- **Model selection.** The user-facing `--model` flag and model aliases were dropped in 0.1.0. The plugin now pins the review model internally: Gemini 3.1 Pro (High), with a Gemini 3.5 Flash (High) fallback, passed via `agy --model`. The `model`, `requestedModel`, and `fellBack` fields appear in `--json` output; there is still no user-facing `--model` flag.
- **Streaming progress.** Lost. `agy --print` returns the full response in one shot. Set a generous `--print-timeout` for longer prompts.
- **Auth.** Now uses Google OAuth via `agy`. `GEMINI_API_KEY` and `gemini auth login` are no longer used.
- **Slash commands.** Unchanged. `/gemini:review` and `/gemini:setup` still work.

Enterprise users with a Gemini Code Assist Standard or Enterprise license retain access to the original `gemini` binary. This plugin no longer targets that path; if you need it, pin to a pre-migration tag.

## Development

```bash
npm test
```

Unit and integration tests. The transport-level tests use a fake spawn fixture and do not require a working `agy` install.

An end-to-end smoke test that requires a working `agy`:

```bash
node tests/smoke-review.mjs
```

This feeds a small synthetic response with deliberately false claims and asserts that (a) the agent returned at least one contradicted/uncertain verdict and (b) at least one claim cites a source URL.

### Deploying changes locally (no version bump)

When this repo is added as a `directory` marketplace, the plugin Claude Code runs is a version-keyed copy under `~/.claude/plugins/cache/<marketplace>/gemini/<version>/`, not this working tree. To make local edits live without bumping the version:

```bash
npm run deploy:local
```

This copies `plugins/gemini/` into the installed cache path in place, leaving the version unchanged. `scripts/` changes take effect on the next `/gemini:review` or `/gemini:setup` (node re-reads them on each run). Run `/reload-plugins` after changing command frontmatter or prompt templates.

For ongoing development you can instead install straight from the path, which reads the working tree live with no copy step:

```bash
/plugin install gemini --path /path/to/gemini-plugin-cc/plugins/gemini
/reload-plugins
```

### Known footguns

- Always quote `$ARGUMENTS` in command markdown (`"$ARGUMENTS"`). Unquoted expansion breaks arguments that contain spaces.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

Portions of the architecture (plugin layout, test patterns, command framing) are adapted from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc), also Apache-2.0.
