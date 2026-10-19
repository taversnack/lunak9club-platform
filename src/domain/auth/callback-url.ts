/**
 * Where to send someone after they sign in. The value comes from the query string (`?callbackUrl=`), so
 * anyone can put anything in it. Only a same-origin relative path is accepted; anything else falls
 * back to the dashboard. This stops open redirects (a sign-in link that bounces to another site).
 */
export const DEFAULT_AFTER_SIGN_IN = '/dashboard';
const MAX_LENGTH = 2048;
const PROBE_ORIGIN = 'https://callback-check.invalid';

/** True if `path` is safe to use as-is: one leading '/', no backslashes, controls or second slash. */
function looksSafe(path: string): boolean {
  if (!path.startsWith('/')) return false; // absolute URLs, schemes (javascript:, data:), relative paths
  if (path.startsWith('//')) return false; // protocol-relative: //evil.example
  // Browsers treat '\' as '/' (so '/\evil.example' is '//evil.example') and drop tabs/newlines.
  if (/[\\\u0000-\u001f\u007f\s]/.test(path)) return false;
  return true;
}

/**
 * Returns `raw` if it's a safe same-origin path (e.g. `/api/payments/pay/123?x=1`), else the dashboard.
 * Percent-encoded tricks (`/%2F%2Fevil.example`, `%2F%5Cevil.example`) are checked by decoding
 * repeatedly, and the result must resolve to this site's origin.
 */
export function safeCallbackPath(raw: unknown, fallback: string = DEFAULT_AFTER_SIGN_IN): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return fallback;
  let current = raw;
  for (let i = 0; i < 4; i++) {
    if (!looksSafe(current)) return fallback;
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return fallback; // malformed escapes
    }
    if (next === current) break;
    current = next;
    if (i === 3) return fallback; // still encoding layers left: refuse rather than guess
  }
  let resolved: URL;
  try {
    resolved = new URL(raw, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (resolved.origin !== PROBE_ORIGIN) return fallback;
  // Sending someone back to the sign-in page after signing in would just loop.
  if (resolved.pathname === '/sign-in' || resolved.pathname.startsWith('/sign-in/')) return fallback;
  return raw;
}

/** The sign-in page URL that brings the visitor back to `path` (path + query) afterwards. */
export function signInPathFor(path: string): string {
  const safe = safeCallbackPath(path, '');
  return safe ? `/sign-in?callbackUrl=${encodeURIComponent(safe)}` : '/sign-in';
}
