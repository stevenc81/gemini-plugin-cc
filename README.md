# gemini-plugin-cc

> **Moved.** This plugin now lives in [stevenc81/claude-plugins](https://github.com/stevenc81/claude-plugins/tree/main/plugins/gemini). This repository is archived. If you installed from here, your install keeps working and gets updates from the new repository. For a new install, run:
>
> ```
> /plugin marketplace add stevenc81/claude-plugins
> /plugin install gemini@stevenc81
> ```

Use the Antigravity CLI (`agy`) from inside Claude Code to fact-check with live web grounding. This plugin is for Claude Code users who want a second-opinion reviewer that goes to the live web (not just training data) to verify claims made in a conversation.

> **Heads up:** This plugin previously spawned `gemini --acp` and spoke ACP (JSON-RPC) over stdio. Google retired Gemini CLI for free/Pro/Ultra users on June 18, 2026 and replaced it with [Antigravity CLI](https://antigravity.google) (`agy`), built in Go. This plugin now runs `agy --print` and reads its JSON output. The slash commands carry over. See [Migration notes](#migration-notes-gemini-cli--antigravity-cli) below.

## Goal

This plugin has one goal: to work reliably when Claude Code agents call it during multi-agent work, such as the author's `orchestrate` skill. The lead session or a subagent must always get Gemini's result back, or a clear error it can act on. Check every change against this goal.

## What you get

- `/gemini:review` fact-checks content from the current conversation. `agy` runs live web searches and returns structured findings: which claims are supported, uncertain, or contradicted, with source URLs.
- `/gemini:ask` sends any prompt to a model through `agy` and returns the answer as is. You can attach files.
- `/gemini:setup` checks that `agy` is installed and signed in, that the review model exists, and how much Gemini quota you have left.

## Requirements

- **Antigravity CLI** 1.3.x or later (`agy --version` must work). The plugin relies on `--output-format=json`, `--json-schema` and `--disable-slash-commands`. See https://antigravity.google
- **Sign-in.** Run `agy -p hello` once interactively. The first call opens a browser for OAuth and writes the session under `~/.gemini/antigravity-cli/`
- **Node.js 18.18 or later**

## Install

```bash
/plugin marketplace add stevenc81/gemini-plugin-cc
/plugin install gemini@stevenc81-gemini
/reload-plugins
```

Then run `/gemini:setup` to check that everything works.

The plugin has no fixed version number. Claude Code uses the git commit as the version, so every push to `main` is a new version. To get the latest one:

```bash
claude plugin marketplace update stevenc81-gemini
claude plugin update gemini@stevenc81-gemini
```

Then run `/reload-plugins`, or start a new session.

## Usage

### `/gemini:review`

Fact-checks content from the current conversation with live web grounding. By default it reviews Claude's previous reply. You can point it at any other text in the conversation instead: an earlier reply, a paragraph you pasted, or one bullet. The agent searches the web for every claim it can check, marks each one `supported`, `uncertain` or `contradicted`, and cites its sources.

```bash
/gemini:review
/gemini:review check the second paragraph above
/gemini:review focus on the version numbers
/gemini:review --model gemini-4-argon-medium check the dates above
```

The only flag is `--model <id>`. Anything else after `/gemini:review` is plain natural language, not fixed syntax. Claude uses it in one of two ways:

- To choose what gets reviewed. Phrases like `check the second paragraph above` or `review what I just pasted` point Claude at specific text instead of its previous reply.
- To steer attention. Phrases like `focus on the version numbers` tell the agent which claims matter most. It still reports any other real issue it finds.

When another skill or agent calls `/gemini:review` and gives it text, it reviews exactly that text.

The review always runs as a background task, and Claude Code tells you when it finishes. In October 2026, a review of three short claims took 93 seconds on Gemini 4 Argon and 219 seconds on Gemini 3.8 Flash. A review of six claims on Flash took 11.5 minutes. A foreground run stops after 9 minutes, and a fallback to Flash adds a second run. The run time depends on the number of claims, not the length of the text.

How it works:
- Claude pipes the selected text to the companion script through a quoted heredoc. No temp files, no copy and paste.
- The companion runs `agy` in an empty temp folder with the review prompt, the JSON schema (`--json-schema`), and JSON output.
- The prompt tells the model to use only web search. Headless `agy` refuses page fetches, file reads and commands, and a refused tool ends the run with no answer.
- Search often returns `vertexaisearch.cloud.google.com/grounding-api-redirect/...` links. The plugin resolves each one to the real page URL (one request each, in parallel, 5 seconds max). If that fails, it keeps the original link.
- The report ends with a `[grounding]` footer. It counts the cited sources and lists any tools `agy` refused.
- Input is capped at 40KB. Longer content is cut on a line boundary, and the report says so.

Model: reviews run on `gemini-4-argon-high` by default. `--model <id>` picks another model from `agy models`. If the run fails, the plugin can retry once on `gemini-3.8-flash-high`. See [Which model runs the review?](#which-model-runs-the-review) for the rules. The header and the `--json` output show which model answered and why a fallback happened.

Limitations:
- Search quality depends on what the agent finds. Niche or paywalled sources may be missed. Read `uncertain` as "search did not find it," not "it is wrong."
- Claude picks the text to review from context. To be sure, quote or paste the exact text.
- `agy` does not report which tools ran, so cited sources are the only sign of grounding.

Output states:

| State | `--json` fields | Text label |
|-------|----------------|------------|
| Success | `parsed` is an object, `parseError` is `null` | `review (N bytes)` |
| Degraded | `parsed` is `null`, `parseError` says why, `rawOutput` holds any text the model sent | `review (N bytes, degraded)` |
| Timed out | `timedOut` is `true`, `stopReason` is `"timeout"` | `review (N bytes, degraded)` plus a line saying the review was cut off |

`model` is the model that answered. `requestedModel` is the model the plugin tried first. `fellBack` is `true` when Flash answered, and `fallbackReason` holds the error from the first run (otherwise `null`). A text report that fell back says so in the header and on the first line.

`deniedActions` lists any tools `agy` refused. When a refusal left the model with no answer, `parseError` names the refused tools.

The exit code is `0` in all three states, because the CLI ran. A nonzero exit means the plugin itself failed (spawn error, sign-in, unknown model, used-up quota, or a hard timeout). After a fallback, a nonzero exit means both models failed, and the error names both causes. To branch on answer quality, read `parseError` and `timedOut` from `--json` output.

### `/gemini:ask`

Sends a prompt to a model and returns its answer exactly as the model wrote it.

```bash
/gemini:ask what changed in the latest Node.js release?
/gemini:ask --model gemini-3.8-flash-high explain this error in plain words
/gemini:ask --file ./notes.md --file ./plan.md which plan is riskier?
/gemini:ask --dir ./core/libs/imgqsort --dir ./core/libs/database/haar how do the blur score and duplicate search work?
/gemini:ask --json summarize this thread
```

- `--model <id>` takes any ID from `agy models`. The default is `gemini-3.8-flash-medium`. An unknown ID fails with a message telling you to run `agy models`. `/gemini:ask` has no fallback model.
- Gemini 4 Argon (`gemini-4-argon-low`, `-medium`, `-high`) uses its own weekly quota. `/gemini:review` uses the same quota, so Argon asks leave fewer Argon reviews.
- The prompt can be up to 100,000 bytes. Pass larger input with `--file`.
- `--file <path>` can repeat. The plugin checks that each file exists and copies it into the empty temp folder that `agy` runs in. Gemini can read those copies and nothing else from the file's folder. The prompt lists the paths of the copies.
- `--dir <folder>` gives Gemini read access to a folder, such as a source tree. It can repeat. `agy` runs in the folders' common parent, and the prompt lists the files in the given folders. The plugin refuses folders whose only common parent is `/` or your home folder. `agy` has no tool to list a folder, so the plugin builds that list. It skips names that start with `.` (such as `.git`), `node_modules` and symlinks. If the list is over 20,000 bytes, pass smaller subfolders. Use `--dir` or `--file`, not both.
- `--json` returns `{model, response, tokens, deniedActions, timedOut}`.
- It runs in the foreground by default. `--background` runs it as a background task.
- `agy` runs in a fresh temp folder that is deleted afterwards. `agy`'s own saved conversations are left alone.
- If `agy` refused a tool or the run timed out, a short note follows the answer.
- The plugin tells Gemini to use web search, web pages and the local files it was given. It also tells Gemini never to run shell commands, write files or start subagents. When `agy` runs without a terminal, it cannot ask you for permission. So one refused tool ends the run, and the answer is empty.
- By default, `agy` also refuses to open web pages. Research jobs, such as reading Reddit threads, need page reads. To allow them, add this to `~/.gemini/antigravity-cli/settings.json`:

  ```json
  "permissions": { "allow": ["read_url(*)"] }
  ```

  Gemini can then open any page it finds. It still cannot run commands or read your other files. A research run can take 8 minutes or more, so use `--background` for it.

### `/gemini:setup`

```bash
/gemini:setup
/gemini:setup --json
```

Setup spends one model call. It sends a canary prompt ("Reply with the single word OK") and checks that the reply echoes it. That proves sign-in works and the prompt really reached the model. A CLI change that makes `agy` exit 0 without seeing the prompt shows up as `Prompt check: FAILED`.

Two free checks run alongside it:
- **Model check** reads `agy models` and looks for the review model (Argon), the fallback model (Flash) and the `/gemini:ask` default. `ok` means all three are listed. `degraded` means one is missing: reviews still run on the other review model, or only `/gemini:ask` without `--model` is affected. `FAILED` (exit 1) means both review models are missing. `unknown` means `agy models` could not run. `--json` reports each model under `models.primary`, `models.fallback` and `models.ask`.
- **Gemini quota** reads `agy -p /usage` and shows the remaining percent with reset times: the weekly and 5-hour limits for Gemini Flash, and the weekly limit for Gemini 4 Argon. If that call fails, setup still runs and shows the quota as unknown. `--json` includes it as `quota`, with Argon under `quota.argon` (`null` when `agy` does not report Argon).

## Configuration

Environment variables:

| Variable | Default | Effect |
|----------|---------|--------|
| `GEMINI_PLUGIN_CC_PROMPT_TIMEOUT_MS` | 1200000 (20 minutes) | Passed to `agy` as `--print-timeout`. When it runs out, `agy` returns what it has so far, and the plugin marks the result as timed out. The plugin's own hard limit is 30 seconds longer, so that partial answer can arrive first. The companion flag `--timeout-ms <n>` overrides it. Foreground runs of `/gemini:review` and `/gemini:ask` pass `--timeout-ms 540000` (9 minutes), to finish before Claude Code's 10-minute limit on a foreground command. |
| `GEMINI_PLUGIN_CC_RESOLVE_SOURCES` | (unset) | Set to `0` to keep grounding redirect links as they are. |
| `GEMINI_PLUGIN_CC_RESOLVE_SOURCES_TIMEOUT_MS` | 5000 | Time limit for resolving each redirect link. |
| `GEMINI_PLUGIN_CC_DEBUG` | (unset) | Set to `1` to include the underlying cause in error output. |

## How it works

For each call, the plugin:

1. Runs `agy` with every flag in `--flag=value` form: `--model`, `--output-format=json`, `--disable-slash-commands`, then `--print=<prompt>` and `--print-timeout`. Reviews add `--json-schema`. The prompt is the value of `--print`, because `agy` ignores stdin in print mode
2. Reads the JSON result: the answer (`structured_output` when a schema was used, otherwise `response`), token usage, and refused tools
3. Checks `agy`'s stderr for its timeout notice, and on a nonzero exit for `AGY_ERROR`, unknown model, used-up quota, and sign-in errors, in that order. The quota check comes before the sign-in check, because a quota message can contain words such as "sign in"
4. For reviews, validates the result against the schema, resolves redirect links, and renders the report

## FAQ

### Does this use my OpenAI / Anthropic account?

No. It uses your Antigravity CLI installation and your Google sign-in.

### Can I still use Codex or Claude Code's own review?

Yes. This plugin is Antigravity-specific and runs independently of other plugins. Use whichever reviewer fits the task.

### Which model runs the review?

`gemini-4-argon-high` by default, with one fallback to `gemini-3.8-flash-high`. `--model <id>` picks another model, for example `gemini-4-argon-medium` for a cheaper check. The fallback rules are the same for a chosen model.

The fallback rules:
- If the first run fails for any other reason than sign-in or a hard timeout, the plugin runs the review once on Flash. If the failed model was Flash at any effort level, there is no second run, because every Flash level uses the same quota. The most likely cause is a used-up Argon quota. An unknown model or another `agy` error also falls back.
- A sign-in error does not fall back, because Flash would fail the same way.
- A hard timeout does not fall back, because it used the whole time budget.
- The timeout is one budget for both runs. Flash gets only the time that is left. If less than 60 seconds are left, the plugin skips Flash and reports the Argon error.
- A run that `agy` cut off at its own time limit is not an error. The plugin returns that partial result and does not fall back.
- The first error is never hidden. The report and `fallbackReason` show it.

Why two models: Argon was faster in a test in October 2026 (93 seconds against 219 seconds for the same three claims). But Argon has only a weekly limit, separate from Flash. One review of three claims used about 1.4% of it. Flash keeps reviews working when the Argon limit runs out.

As of `agy` 1.3.6, `agy models` lists `gemini-4-argon-{low,medium,high}`, `gemini-3.8-flash-{high,medium,low}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}` and `gpt-oss-120b-medium`. `/gemini:setup` checks both review models and the `/gemini:ask` default, so a rename shows up there first.

### Why is a grounded review slow?

Each claim needs at least one web search, and the model reasons over the results. A review of four or five claims can take several minutes. `agy` does not stream progress, so the wait is silent until the answer arrives.

### Does the search cost money?

Your `agy` sign-in governs billing and quota. `/gemini:setup` shows how much Gemini quota you have left. See your Antigravity plan for details.

## Migration notes (Gemini CLI → Antigravity CLI)

On May 19, 2026 at Google I/O, Google announced that Gemini CLI was being retired for free/Pro/Ultra users on June 18, 2026 and replaced with Antigravity CLI (`agy`). This plugin migrated in response. What changed and what stayed:

- **Transport.** Now spawns `agy` in print mode and reads its JSON output. The previous ACP JSON-RPC handshake (`initialize`, `session/new`, `session/set_mode`, `session/set_model`, `session/prompt`, `session/cancel`, `session/update`) is gone; `agy` does not expose ACP. Since agy 1.1.x, `--print` takes the prompt as its value. Bare `--print` with the prompt on stdin exits 2 with `flag needs an argument`, because stdin is ignored in print mode. So the plugin passes `--print=<prompt>`. It needs agy 1.3.x or later.
- **Plan mode.** Removed. Headless `agy` cannot ask for permission, so it refuses file writes, commands and page fetches. Reviews stay read-only without a session mode.
- **Tool-call observability.** Lost. `agy` does not report which tools ran. The `[grounding]` footer counts cited sources and lists any tools `agy` refused.
- **Model selection.** Reviews pin the model, passed as `--model=<id>`. See [Which model runs the review?](#which-model-runs-the-review). Model IDs are the ones `agy models` prints. `/gemini:ask` takes any of them with `--model`.
- **Streaming progress.** Lost. `agy --print` returns the full response in one shot. The default timeout is 20 minutes.
- **Auth.** Now uses Google OAuth via `agy`. `GEMINI_API_KEY` and `gemini auth login` are no longer used.
- **Slash commands.** `/gemini:review` and `/gemini:setup` still work. `/gemini:ask` is new.

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

### Trying changes before you push

Start Claude Code with the plugin loaded from your working tree. This applies to that session only:

```bash
claude --plugin-dir ./plugins/gemini
```

### Known problems

- Do not paste `$ARGUMENTS` into a shell string in command markdown. Quotes, `$` or a backtick in the user's text then break the command. `review.md` and `ask.md` tell Claude to pass each flag as its own argument and the free text as one single-quoted argument.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.

Portions of the architecture (plugin layout, test patterns, command framing) are adapted from [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc), also Apache-2.0.
