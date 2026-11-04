import { describe, expect, it } from 'vitest';
import { browserFamily, maskIp } from '@/domain/auth/session-display';

describe('maskIp', () => {
  it('hides the last part of an IPv4 address', () => {
    expect(maskIp('203.0.113.42')).toBe('203.0.113.xxx');
    expect(maskIp('::ffff:203.0.113.42')).toBe('203.0.113.xxx');
  });
  it('keeps only the first three groups (a /48) of an IPv6 address', () => {
    expect(maskIp('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:xxxx::');
    expect(maskIp('2001:db8:abcd:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd:xxxx::');
  });
  it('shows nothing for an empty, odd or unspecified-prefix value', () => {
    expect(maskIp(null)).toBeNull();
    expect(maskIp('')).toBeNull();
    expect(maskIp('not an ip')).toBeNull();
    expect(maskIp('::1')).toBeNull();
  });
});

describe('browserFamily', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Chrome',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0', 'Edge'],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Safari',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox'],
    ['curl/8.0', 'Other'],
  ])('%s', (ua, family) => {
    expect(browserFamily(ua)).toBe(family);
  });
  it('is null without a user agent and never returns the string itself', () => {
    expect(browserFamily(null)).toBeNull();
    expect(browserFamily('Mozilla/5.0 secret-device-id-123 Firefox/128.0')).toBe('Firefox');
  });
});
