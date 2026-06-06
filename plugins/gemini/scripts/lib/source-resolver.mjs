const GROUNDING_HOSTS = new Set([
  "vertexaisearch.cloud.google.com"
]);
const GROUNDING_PATH_PREFIX = "/grounding-api-redirect/";

export function isGroundingRedirectUrl(url) {
  if (typeof url !== "string" || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    GROUNDING_HOSTS.has(parsed.hostname) &&
    parsed.pathname.startsWith(GROUNDING_PATH_PREFIX)
  );
}

async function resolveOne(url, { fetchFn, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetchFn(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal
    });
    const finalUrl = response?.url;
    if (typeof finalUrl === "string" && finalUrl && !isGroundingRedirectUrl(finalUrl)) {
      return finalUrl;
    }
    return url;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk a parsed review result and resolve any grounding-redirect URLs in
 * claim sources to their final publisher URLs. Leaves non-grounding URLs
 * untouched. Returns the same parsed object (mutated).
 */
export async function resolveSources(
  parsed,
  {
    fetchFn = globalThis.fetch,
    timeoutMs = 3000,
    enabled = true
  } = {}
) {
  if (!enabled) return parsed;
  if (!parsed || !Array.isArray(parsed.claims)) return parsed;
  if (typeof fetchFn !== "function") return parsed;

  const jobs = [];
  for (const claim of parsed.claims) {
    if (!Array.isArray(claim.sources)) continue;
    claim.sources.forEach((url, index) => {
      if (!isGroundingRedirectUrl(url)) return;
      jobs.push(
        resolveOne(url, { fetchFn, timeoutMs }).then((resolved) => {
          claim.sources[index] = resolved;
        })
      );
    });
  }
  if (jobs.length === 0) return parsed;
  await Promise.allSettled(jobs);
  return parsed;
}
