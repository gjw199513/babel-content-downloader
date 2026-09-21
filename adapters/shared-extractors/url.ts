const TRACKING_KEYS = new Set([
  "fbclid", "gclid", "igshid", "mkt_tok", "ref", "source", "spm", "share_source", "share_token",
]);
const SENSITIVE_QUERY_KEY = /(?:token|signature|sig|sign|auth|session|cookie|xsec|credential|key|nonce|expires?|timestamp|^sn$)/i;

export function matchesHost(hostname: string, pattern: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const expected = pattern.toLowerCase().replace(/\.$/, "");
  if (expected.startsWith("*.")) {
    const suffix = expected.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === expected;
}

export function matchesAnyHost(url: URL, hosts: readonly string[]): boolean {
  return hosts.some(host => matchesHost(url.hostname, host));
}

export function cleanCanonicalUrl(input: URL, preserve: readonly string[] = []): URL {
  const url = new URL(input.href);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_KEYS.has(key.toLowerCase())) {
      if (!preserve.includes(key)) url.searchParams.delete(key);
    }
  }
  return url;
}

/**
 * A URL used as source metadata must be useful for identity without retaining
 * short-lived signed navigation material. The original target URL remains in
 * runtime memory and is never reconstructed from this value for navigation.
 */
export function publicReferenceUrl(input: URL, preserve: readonly string[] = []): URL {
  const url = cleanCanonicalUrl(input, preserve);
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.delete(key);
  }
  return url;
}

export function safeHttpUrl(value: string | null, base: URL): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Asset host patterns are data egress allowlists, never a hint to follow arbitrary page URLs. */
export function isAllowedAssetUrl(url: URL, allowedHosts: readonly string[]): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return matchesAnyHost(url, allowedHosts);
}
