import { describe, expect, it } from 'vitest';
import { buildCsp } from '@/domain/security/csp';

const policy = (o: Partial<Parameters<typeof buildCsp>[0]> = {}) =>
  Object.fromEntries(
    buildCsp({ nonce: 'abc123', development: false, secure: false, ...o })
      .split('; ')
      .map((d) => [d.split(' ')[0], d.split(' ').slice(1)]),
  ) as Record<string, string[]>;

describe('buildCsp', () => {
  it('runs only our own and nonce-marked scripts, never eval or arbitrary inline scripts in production', () => {
    const s = policy()['script-src']!;
    expect(s).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(s).not.toContain("'unsafe-inline'");
    expect(s).not.toContain("'unsafe-eval'");
  });
  it('allows eval only in development', () => {
    expect(policy({ development: true })['script-src']).toContain("'unsafe-eval'");
  });
  it('blocks plugins, embedding and foreign base URLs, and limits forms to us and the card checkout', () => {
    const p = policy();
    expect(p['object-src']).toEqual(["'none'"]);
    expect(p['frame-ancestors']).toEqual(["'none'"]);
    expect(p['base-uri']).toEqual(["'self'"]);
    expect(p['form-action']).toEqual(["'self'", 'https://checkout.stripe.com']);
    expect(p['default-src']).toEqual(["'self'"]);
  });
  it('asks browsers to upgrade insecure requests only on https', () => {
    expect(buildCsp({ nonce: 'n', development: false, secure: true })).toContain('upgrade-insecure-requests');
    expect(buildCsp({ nonce: 'n', development: false, secure: false })).not.toContain('upgrade-insecure-requests');
  });
});
