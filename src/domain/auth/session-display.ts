/**
 * How a session's network address and browser are shown (and kept): masked, never raw. The raw IP
 * address and user agent string are personal data (UK GDPR) and are cleared 30 days after a session
 * ends (D64 amended); until then only these coarse forms are displayed.
 */

/** 203.0.113.42 -> 203.0.113.xxx ; 2001:db8:abcd:12::1 -> 2001:db8:abcd:xxxx:: ; anything else -> null. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.xxx`;
  const mapped = ip.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i);
  if (mapped) return `${mapped[1]}.${mapped[2]}.${mapped[3]}.xxx`;
  if (ip.includes(':') && /^[0-9a-f:]+$/i.test(ip)) {
    const groups = ip.split(':');
    const head = ip.startsWith('::') ? [] : groups.slice(0, 3).filter((g) => g !== '');
    return head.length ? `${head.join(':')}:xxxx::` : null;
  }
  return null;
}

/** Browser family only (no version, device or operating system), or null when there is no user agent. */
export function browserFamily(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Other';
}
