import process from "node:process";

function indent(text, prefix = "  ") {
  return text
    .split("\n")
    .map((l) => (l.length ? prefix + l : l))
    .join("\n");
}

function formatTokens(tokens) {
  if (!tokens) return "";
  const input = tokens.input_tokens ?? null;
  const output = tokens.output_tokens ?? null;
  if (input == null && output == null) return "";
  return ` (tokens: ${input ?? "?"} in / ${output ?? "?"} out)`;
}

function formatHeader({ reviewLabel, target, tokens, agentVersion, model, fellBack, requestedModel }) {
  const parts = [`${reviewLabel}: ${target}`];
  if (agentVersion) parts.push(`agy ${agentVersion}`);
  if (model) {
    parts.push(
      fellBack && requestedModel
        ? `model: ${model} (fell back from ${requestedModel})`
        : `model: ${model}`
    );
  }
  return parts.join("  |  ") + formatTokens(tokens);
}

function countClaimSources(parsed) {
  if (!parsed || !Array.isArray(parsed.claims)) return 0;
  let n = 0;
  for (const c of parsed.claims) {
    if (Array.isArray(c.sources)) n += c.sources.filter(Boolean).length;
  }
  return n;
}

const VERDICT_ORDER = { contradicted: 0, uncertain: 1, supported: 2 };

function summarizeToolCalls(toolCalls = []) {
  const counts = { google_web_search: 0, web_fetch: 0, other: 0 };
  for (const tc of toolCalls) {
    const name = String(tc?.name ?? tc?.kind ?? "").toLowerCase();
    if (name.includes("search")) counts.google_web_search += 1;
    else if (name.includes("fetch")) counts.web_fetch += 1;
    else counts.other += 1;
  }
  return counts;
}

export function renderReviewResult({
  parsed,
  parseError,
  rawOutput,
  target,
  tokens,
  agentVersion,
  model = null,
  requestedModel = null,
  fellBack = false,
  toolCalls = []
}) {
  const labelParts = [];
  if (target?.inputBytes != null) labelParts.push(`${target.inputBytes} bytes`);
  if (target?.truncated) labelParts.push(`truncated by ${target.omittedBytes}`);
  if (parseError) labelParts.push("degraded");
  const label = labelParts.length ? `review (${labelParts.join(", ")})` : "review";
  const header = formatHeader({
    reviewLabel: "Gemini Review",
    target: label,
    tokens,
    agentVersion,
    model,
    requestedModel,
    fellBack
  });
  const lines = [header, "=".repeat(Math.min(header.length, 80)), ""];

  if (parseError) {
    const rawText = String(rawOutput ?? "").trim();
    if (rawText) {
      lines.push(
        "Schema validation failed; Gemini's raw reasoning is preserved below and may still be usable.",
        `(${parseError})`,
        ""
      );
      lines.push("Raw output:");
      lines.push(indent(rawText));
    } else {
      lines.push(`Gemini returned no usable output. (${parseError})`);
    }
    return lines.join("\n") + "\n";
  }

  lines.push(`Overall: ${parsed.overall}`);
  lines.push("");
  lines.push(`Summary: ${parsed.summary}`);
  lines.push("");

  const claims = [...(parsed.claims ?? [])].sort((a, b) => {
    return (VERDICT_ORDER[a.verdict] ?? 9) - (VERDICT_ORDER[b.verdict] ?? 9);
  });

  if (claims.length === 0) {
    lines.push("No claims analysed.");
    lines.push("");
  } else {
    lines.push(`Claims (${claims.length}):`);
    lines.push("");
    claims.forEach((c, i) => {
      lines.push(`${i + 1}. [${c.verdict}] ${c.claim}`);
      lines.push(indent(c.reasoning));
      if (c.verdict === "contradicted" && c.correction) {
        lines.push(indent(`→ correction: ${c.correction}`));
      }
      const sources = Array.isArray(c.sources) ? c.sources.filter(Boolean) : [];
      if (sources.length > 0) {
        lines.push(indent("sources:"));
        for (const url of sources) lines.push(indent(`  - ${url}`));
      }
      lines.push("");
    });
  }

  const issues = parsed.reasoning_issues ?? [];
  if (issues.length > 0) {
    lines.push(`Reasoning issues (${issues.length}):`);
    lines.push("");
    issues.forEach((x, i) => {
      lines.push(`${i + 1}. ${x.issue}`);
      lines.push(indent(x.explanation));
      lines.push("");
    });
  }

  if (target?.truncated) {
    lines.push(`[note] Input was truncated by ${target.omittedBytes} bytes before review.`);
  }

  const counts = summarizeToolCalls(toolCalls);
  const totalGrounding = counts.google_web_search + counts.web_fetch;
  if (totalGrounding > 0) {
    const parts = [];
    if (counts.google_web_search > 0) parts.push(`${counts.google_web_search} web search${counts.google_web_search === 1 ? "" : "es"}`);
    if (counts.web_fetch > 0) parts.push(`${counts.web_fetch} page fetch${counts.web_fetch === 1 ? "" : "es"}`);
    lines.push(`[grounding] ${parts.join(", ")} used.`);
  } else {
    const sourceCount = countClaimSources(parsed);
    if (sourceCount > 0) {
      lines.push(
        `[grounding] ${sourceCount} source URL${sourceCount === 1 ? "" : "s"} cited. ` +
          "Tool calls are not surfaced by `agy --print`; rely on claim sources for evidence."
      );
    } else {
      lines.push(
        "[grounding] No claim sources cited and tool calls are not surfaced by `agy --print`. Treat results as ungrounded."
      );
    }
  }

  return lines.join("\n") + "\n";
}

export function renderSetupReport({
  agy = null,
  version = null,
  transportOk = false,
  authOk = false,
  authDetail = null,
  roundTripMs = null,
  nextSteps = []
}) {
  const lines = ["Gemini Plugin Setup Check (via Antigravity CLI)", "=================================================", ""];
  lines.push(`agy binary:    ${agy?.available ? "available" : "NOT FOUND"}${agy?.detail ? ` (${agy.detail})` : ""}`);
  lines.push(`Transport:     ${transportOk ? `ok${version ? ` (agy ${version})` : ""}` : "failed"}`);
  lines.push(`Auth check:    ${authOk ? "ok" : "failed"}${authDetail ? ` — ${authDetail}` : ""}`);
  if (roundTripMs != null) lines.push(`Round trip:    ${roundTripMs}ms`);
  if (nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    for (const step of nextSteps) lines.push(`  - ${step}`);
  }
  return lines.join("\n") + "\n";
}

export function renderError(err) {
  const debug = process.env.GEMINI_PLUGIN_CC_DEBUG === "1";
  const name = err?.name ?? "Error";
  const message = err?.message ?? String(err);
  const suggestion = err?.suggestion ?? null;

  const parts = [`${name}: ${message}`];
  if (suggestion) parts.push(`  → ${suggestion}`);
  if (debug && err?.cause) {
    const causeText =
      err.cause instanceof Error
        ? `${err.cause.stack ?? err.cause.message}`
        : JSON.stringify(err.cause);
    parts.push("", "[debug] cause:");
    parts.push(indent(causeText, "    "));
  }
  return parts.join("\n") + "\n";
}
