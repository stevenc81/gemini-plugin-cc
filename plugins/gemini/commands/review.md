---
description: Fact-check conversation content via Antigravity CLI with live web grounding
argument-hint: '[--wait|--background] [focus text]'
disable-model-invocation: false
allowed-tools: Bash(node:*), AskUserQuestion
---

Run a grounded fact-check of content from the current conversation via `agy --print` (Antigravity CLI). The agent autonomously runs live web searches and returns structured findings: which claims are supported, uncertain, or contradicted, with source URLs, plus any reasoning issues.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is analysis-only.
- Do not fix issues, edit files, or change your answer.
- Your only job is to run the review and return Gemini's output verbatim to the user.

Input handling:
- Determine what to review from the user's message and conversation context:
  - If the user points at specific content (e.g., "review your last reply", "check the second bullet above", "review the paragraph starting with...", "review what I just pasted"), pass exactly that content.
  - Otherwise, default to the full text of your immediately previous assistant turn.
- Pass the selected content verbatim via stdin using a quoted heredoc. Do not paraphrase or abridge it.
- If there is nothing suitable to review (e.g., the user gave no reference and this is the first message of the session), stop and tell the user: "Nothing to review. Point me at the text you want audited (e.g., 'review your last reply' or paste the content), then rerun /gemini:review."

Execution mode rules:
- If the raw arguments include `--wait`, do not ask. Run the review in the foreground.
- If the raw arguments include `--background`, do not ask. Run the review in a Claude background task.
- Otherwise, count the characters in the selected content:
  - If the selected content is roughly >5000 characters, recommend `Run in background`.
  - Otherwise recommend `Wait for results`.
  - Use `AskUserQuestion` exactly once with two options, recommended option first and suffixed with `(Recommended)`:
    - `Wait for results`
    - `Run in background`
  - If the user cancels or dismisses the question, abort and tell them: "Cancelled. No review was run."

Foreground flow:
- Invoke with a quoted heredoc so the selected content is piped in literally (no shell expansion inside the content):
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review "$ARGUMENTS" <<'GEMINI_REVIEW_INPUT_EOF'
<the full text of the content to review, verbatim>
GEMINI_REVIEW_INPUT_EOF
```
- Return the command's stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- Do not edit any file or follow up on any finding.

Background flow:
- Launch the review with `Bash` in the background using the same heredoc form:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review "$ARGUMENTS" <<'GEMINI_REVIEW_INPUT_EOF'
<the full text of the content to review, verbatim>
GEMINI_REVIEW_INPUT_EOF`,
  description: "Gemini review",
  run_in_background: true
})
```
- After launching, tell the user: "Gemini review started in the background. You will be notified when it finishes."
