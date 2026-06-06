import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTemplate, loadSchemaText, renderPrompt } from "../plugins/gemini/scripts/lib/prompts.mjs";
import { ConfigError } from "../plugins/gemini/scripts/lib/errors.mjs";

test("loadTemplate reads review.md", () => {
  const t = loadTemplate("review");
  assert.match(t, /analytical reviewer/);
  assert.match(t, /\{\{CONTENT\}\}/);
  assert.match(t, /\{\{USER_FOCUS\}\}/);
});

test("review template contains grounding directive", () => {
  const t = loadTemplate("review");
  assert.match(t, /google_web_search/);
  assert.match(t, /web_fetch/);
  assert.match(t, /sources/);
});

test("loadSchemaText returns raw JSON schema by default", () => {
  const s = loadSchemaText();
  const parsed = JSON.parse(s);
  assert.equal(parsed.type, "object");
  assert.ok(parsed.required.includes("overall"));
  assert.ok(parsed.required.includes("claims"));
});

test("loadSchemaText supports explicit review-output name", () => {
  const s = loadSchemaText("review-output");
  const parsed = JSON.parse(s);
  assert.ok(parsed.required.includes("overall"));
});

test("schema advertises optional sources per claim", () => {
  const s = loadSchemaText("review-output");
  assert.match(s, /"sources":/);
});

test("renderPrompt('review') substitutes CONTENT and USER_FOCUS", () => {
  const { text } = renderPrompt("review", {
    CONTENT: "Claude said Redis is AP.",
    USER_FOCUS: "verify database claims"
  });
  assert.match(text, /Redis is AP/);
  assert.match(text, /verify database claims/);
  assert.doesNotMatch(text, /\{\{CONTENT\}\}/);
  assert.doesNotMatch(text, /\{\{USER_FOCUS\}\}/);
});

test("renderPrompt('review') auto-embeds review schema", () => {
  const { text } = renderPrompt("review", {
    CONTENT: "c",
    USER_FOCUS: "f"
  });
  assert.match(text, /"overall":/);
  assert.match(text, /trustworthy/);
  assert.match(text, /problematic/);
  assert.doesNotMatch(text, /\{\{SCHEMA\}\}/);
});

test("renderPrompt throws ConfigError for missing placeholder", () => {
  assert.throws(
    () => renderPrompt("review", { CONTENT: "c" /* missing USER_FOCUS */ }),
    ConfigError
  );
});

test("renderPrompt accepts SCHEMA override", () => {
  const { text } = renderPrompt("review", {
    CONTENT: "c",
    USER_FOCUS: "f",
    SCHEMA: "CUSTOM-SCHEMA-MARKER"
  });
  assert.match(text, /CUSTOM-SCHEMA-MARKER/);
});

test("renderPrompt throws ConfigError for prompt with no schema binding", () => {
  assert.throws(
    () => renderPrompt("nonexistent-template-name", {}),
    Error
  );
});

test("review template is well-formed: every closing tag has a matching opening tag", () => {
  // Guards against orphan/mismatched section delimiters (e.g. an <output_contract>
  // block accidentally closed with </output>). Operates on the raw template so the
  // {{CONTENT}}/{{USER_FOCUS}}/{{SCHEMA}} placeholders carry no angle brackets.
  const t = loadTemplate("review");
  const open = [];
  const unmatched = [];
  const tagRe = /<(\/?)([a-z_]+)>/g;
  let m;
  while ((m = tagRe.exec(t)) !== null) {
    const [, slash, name] = m;
    if (slash) {
      const idx = open.lastIndexOf(name);
      if (idx === -1) unmatched.push(name);
      else open.splice(idx, 1);
    } else {
      open.push(name);
    }
  }
  assert.deepEqual(unmatched, [], `orphan closing tag(s): ${unmatched.map((n) => `</${n}>`).join(", ")}`);
  assert.deepEqual(open, [], `unclosed opening tag(s): ${open.map((n) => `<${n}>`).join(", ")}`);
});
