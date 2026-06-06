export function byteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

/**
 * Truncate content to at most maxBytes UTF-8 bytes, breaking only on line
 * boundaries. Appends a marker indicating how many bytes were elided.
 *
 * Returns { content, truncated, omittedBytes }.
 */
export function truncateOnLineBoundary(content, maxBytes) {
  if (byteLength(content) <= maxBytes) {
    return { content, truncated: false, omittedBytes: 0 };
  }
  const lines = content.split(/\r?\n/);
  let used = 0;
  const kept = [];
  for (const line of lines) {
    const size = byteLength(line) + 1;
    if (used + size > maxBytes) break;
    used += size;
    kept.push(line);
  }
  const truncated = kept.join("\n");
  const omittedBytes = byteLength(content) - byteLength(truncated);
  return {
    content: `${truncated}\n[truncated: ${omittedBytes} additional bytes elided]`,
    truncated: true,
    omittedBytes
  };
}
