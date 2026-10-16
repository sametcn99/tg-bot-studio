/**
 * URL safety helpers for operator-configured outbound targets (webhook
 * endpoints). Best-effort SSRF guard: blocks non-HTTP(S) schemes and IP
 * literals/hosts that resolve to loopback, private, or link-local ranges so a
 * compromised admin session cannot pivot the studio into the internal network.
 * DNS names that resolve to private addresses are not detected synchronously —
 * set WEBHOOKS_ALLOW_PRIVATE=1 to intentionally allow internal targets.
 */

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

/**
 * Checks whether a host string is a private/loopback/link-local IP literal.
 * @param {string} host - Hostname or IP literal (no port).
 * @returns {boolean} True when the host must not be fetched.
 */
function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === 'localhost' || BLOCKED_HOSTNAMES.has(lower)) return true;
  if (lower === '::1' || lower === '::' || lower.endsWith('.local')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;

  const ipv4 = lower.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validates that a URL is an absolute http(s) URL pointing at a public host.
 * @param {string} raw - URL to validate.
 * @param {{allowPrivate?: boolean}} [options] - Overrides for lab environments.
 * @returns {string | null} Error message when invalid, null when allowed.
 */
export function assertPublicHttpUrl(
  raw: string,
  options?: { allowPrivate?: boolean },
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return 'URL is not a valid absolute URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only http(s) URLs are allowed';
  }
  const allowPrivate = options?.allowPrivate ?? process.env.WEBHOOKS_ALLOW_PRIVATE === '1';
  if (!allowPrivate && isPrivateHost(parsed.hostname)) {
    return 'Internal/private network targets are not allowed';
  }
  return null;
}

/**
 * Validates that a redirect target is a well-formed http(s) URL.
 * @param {string} raw - URL to validate.
 * @returns {boolean} True when the URL is http(s).
 */
export function isHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
