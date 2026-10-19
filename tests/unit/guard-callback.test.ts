import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { RETURN_TO_HEADER, returnToFrom, signInPathFor } from '@/domain/auth/callback-url';
import { config, proxy } from '@/proxy';

describe('returnToFrom', () => {
  it('keeps path and query', () => {
    expect(returnToFrom('/account/bookings', '?payment=expired&x=1')).toBe('/account/bookings?payment=expired&x=1');
    expect(returnToFrom('/admin', '')).toBe('/admin');
  });
  it("drops Next's internal _rsc parameter", () => {
    expect(returnToFrom('/admin/bookings', '?_rsc=1x2y')).toBe('/admin/bookings');
    expect(returnToFrom('/admin/bookings', '?date=2026-11-02&_rsc=1x2y')).toBe('/admin/bookings?date=2026-11-02');
  });
  it('round-trips into a safe sign-in link', () => {
    expect(signInPathFor(returnToFrom('/admin/bookings', '?date=2026-11-02'))).toBe(
      '/sign-in?callbackUrl=%2Fadmin%2Fbookings%3Fdate%3D2026-11-02',
    );
  });
});

/** The request headers the proxy hands on to the page (Next's override protocol). */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe('proxy', () => {
  it('passes the requested page (path + query) to the server', () => {
    const res = proxy(new NextRequest('http://localhost:3000/account/dogs/abc?tab=vet&_rsc=zz'));
    expect(forwarded(res, RETURN_TO_HEADER)).toBe('/account/dogs/abc?tab=vet');
  });

  it('overwrites a value the client sent, so it can never be spoofed', () => {
    const res = proxy(
      new NextRequest('http://localhost:3000/admin', { headers: { [RETURN_TO_HEADER]: '//evil.example' } }),
    );
    expect(forwarded(res, RETURN_TO_HEADER)).toBe('/admin');
  });

  it('runs on pages but not on API routes or static files', () => {
    // The matcher is a single regex-style pattern, so it can be checked as a plain RegExp.
    const re = new RegExp(`^${config.matcher[0]!}$`);
    for (const p of ['/admin', '/account/bookings', '/admin/dogs/1/check', '/']) expect(re.test(p), p).toBe(true);
    for (const p of ['/api/payments/pay/1', '/_next/static/x.js', '/favicon.ico', '/logo.png'])
      expect(re.test(p), p).toBe(false);
  });
});
