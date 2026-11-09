import { describe, expect, it } from 'vitest';
import { clientAddress } from '@/server/rate-limit';

const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe('clientAddress (same trust rules as the auth rate limit)', () => {
  it('trusts no header unless one is configured', () => {
    expect(
      clientAddress(h({ 'x-forwarded-for': '203.0.113.7' }), { TRUSTED_PROXIES: [], CLIENT_IP_HEADER: undefined }),
    ).toBe('unknown');
  });
  it('reads a header the edge always overwrites', () => {
    const e = { TRUSTED_PROXIES: [], CLIENT_IP_HEADER: 'cf-connecting-ip' };
    expect(clientAddress(h({ 'cf-connecting-ip': '203.0.113.7' }), e)).toBe('203.0.113.7');
    expect(clientAddress(h({ 'cf-connecting-ip': 'not an ip' }), e)).toBe('unknown');
    expect(clientAddress(h({}), e)).toBe('unknown');
  });
  it('reads X-Forwarded-For from the right, past our own proxies, so a forged left value is ignored', () => {
    const e = { TRUSTED_PROXIES: ['10.0.0.0/8', '192.0.2.1'], CLIENT_IP_HEADER: undefined };
    expect(clientAddress(h({ 'x-forwarded-for': '6.6.6.6, 203.0.113.7, 10.1.2.3' }), e)).toBe('203.0.113.7');
    expect(clientAddress(h({ 'x-forwarded-for': '203.0.113.7, 192.0.2.1' }), e)).toBe('203.0.113.7');
    expect(clientAddress(h({ 'x-forwarded-for': '10.1.1.1, 10.2.2.2' }), e)).toBe('unknown');
    expect(clientAddress(h({ 'x-forwarded-for': 'garbage, 10.1.1.1' }), e)).toBe('unknown');
  });
});
