---
description: Check whether Antigravity CLI is installed and signed in
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Check whether Antigravity CLI (`agy`) is installed, the print transport works, and auth is valid.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup "$ARGUMENTS"
```

Return the output verbatim to the user. Do not paraphrase.
