import { describe, expect, it } from 'vitest';
import { safeCallbackPath, signInPathFor } from '@/domain/auth/callback-url';

describe('safeCallbackPath (where to go after sign-in)', () => {
  it.each([
    '/api/payments/pay/0b8f3c1e-9d1a-4c39-9a51-2a8f1c3d4e5f',
    '/api/payments/pay-booking/abc',
    '/api/payments/return?attempt=abc&cancelled=1',
    '/account/bookings?payment=expired#top',
    '/account',
    '/',
    '/caf%C3%A9', // encoded but harmless
  ])('keeps the same-origin path %s', (p) => {
    expect(safeCallbackPath(p)).toBe(p);
  });

  it.each([
    ['protocol-relative', '//evil.example'],
    ['protocol-relative with path', '//evil.example/api/payments/pay/1'],
    ['triple slash', '///evil.example'],
    ['backslash', '/\\evil.example'],
    ['double backslash', '\\\\evil.example'],
    ['backslash later on', '/account\\..\\..\\evil'],
    ['absolute https', 'https://evil.example/'],
    ['absolute http', 'http://localhost:3000/account'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['data scheme', 'data:text/html,<script>alert(1)</script>'],
    ['mixed-case scheme', 'JaVaScRiPt:alert(1)'],
    ['no leading slash', 'account/bookings'],
    ['dot-relative', './account'],
    ['encoded double slash', '/%2F%2Fevil.example'],
    ['encoded first slash', '%2F%2Fevil.example'],
    ['encoded backslash', '/%5Cevil.example'],
    ['upper-case encoded', '/%2f%5cevil.example'],
    ['double-encoded slashes', '/%252F%252Fevil.example'],
    ['triple-encoded', '/%25252F%25252Fevil.example'],
    ['encoded scheme', '%6A%61%76%61%73%63%72%69%70%74:alert(1)'],
    ['tab trick', '/\t/evil.example'],
    ['newline trick', '/\n/evil.example'],
    ['leading space', ' /account'],
    ['null byte', '/account\u0000'],
    ['encoded newline', '/%0A/evil.example'],
    ['malformed escape', '/%E0%A4%A'],
    ['sign-in loop', '/sign-in?callbackUrl=/account'],
    ['empty', ''],
    ['too long', `/${'a'.repeat(3000)}`],
  ])('rejects %s', (_label, p) => {
    expect(safeCallbackPath(p)).toBe('/dashboard');
  });

  it('rejects anything that is not a single string (e.g. a repeated query param)', () => {
    for (const v of [undefined, null, 42, ['/account', '//evil.example'], { href: '/account' }])
      expect(safeCallbackPath(v)).toBe('/dashboard');
  });

  it('uses the given fallback', () => {
    expect(safeCallbackPath('//evil.example', '/account')).toBe('/account');
  });
});

describe('signInPathFor', () => {
  it('encodes the way back into the sign-in link', () => {
    expect(signInPathFor('/api/payments/return?attempt=a&cancelled=1')).toBe(
      '/sign-in?callbackUrl=%2Fapi%2Fpayments%2Freturn%3Fattempt%3Da%26cancelled%3D1',
    );
  });
  it('drops an unsafe target', () => {
    expect(signInPathFor('//evil.example')).toBe('/sign-in');
  });
});

describe('safeCallbackPath never throws', () => {
  it.each([
    '%E0%A4%A',
    '/%E0%A4%A',
    '/%',
    '/%%',
    '/%zz',
    '/%uD800',
    '/\uD800',
    '/%ED%A0%80',
    '/%C0%AF',
    '%25E0%25A4%25A',
    '/%FF',
  ])('%s', (raw) => {
    expect(() => safeCallbackPath(raw)).not.toThrow();
    expect(safeCallbackPath(raw).startsWith('/')).toBe(true);
  });
});
