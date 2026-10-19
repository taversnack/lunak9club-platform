/**
 * Under `next start`, req.url is always the server's own origin (localhost:PORT) whatever the Host or
 * X-Forwarded-Host header says, so redirects built from it sent customers to localhost. These routes
 * must redirect to APP_URL's origin: never the server's host and never a client-supplied one.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const APP_ORIGIN = 'https://club-app.example.org';

vi.mock('@/server/session', () => ({ getActor: async () => ({ kind: 'anonymous' }) }));

beforeAll(() => {
  vi.stubEnv('APP_URL', APP_ORIGIN);
  vi.stubEnv('DATABASE_URL', 'postgres://unused:unused@127.0.0.1:1/unused');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret-000');
  vi.stubEnv('APP_ENV', 'test');
});

const foreign = (path: string) =>
  new Request(`http://localhost:3297${path}`, {
    headers: { host: 'club.example.com', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
  });

describe('payment routes redirect a signed-out visitor to APP_URL, whatever the Host header', () => {
  it.each([
    [
      'pay link',
      '/api/payments/pay/0b8f3c1e-9d1a-4c39-9a51-2a8f1c3d4e5f',
      async () => (await import('@/app/api/payments/pay/[attemptId]/route')).GET,
      { attemptId: '0b8f3c1e-9d1a-4c39-9a51-2a8f1c3d4e5f' },
    ],
    [
      'pay booking',
      '/api/payments/pay-booking/7a1d',
      async () => (await import('@/app/api/payments/pay-booking/[bookingId]/route')).GET,
      { bookingId: '7a1d' },
    ],
  ] as const)('%s', async (_label, path, load, params) => {
    const GET = (await load()) as (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
    const res = await GET(foreign(path), { params: Promise.resolve(params) });
    expect([302, 303, 307]).toContain(res.status);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin).toBe(APP_ORIGIN);
    expect(loc.pathname).toBe('/sign-in');
    expect(loc.searchParams.get('callbackUrl')).toBe(path);
  });

  it('checkout return', async () => {
    const { GET } = await import('@/app/api/payments/return/route');
    const res = await GET(foreign('/api/payments/return?attempt=abc&cancelled=1'));
    const loc = new URL(res.headers.get('location')!);
    expect(loc.origin).toBe(APP_ORIGIN);
    expect(loc.searchParams.get('callbackUrl')).toBe('/api/payments/return?attempt=abc&cancelled=1');
  });
});

describe('seeOtherInApp (signed-in redirects inside the site)', () => {
  it('uses a relative Location, so the client resolves it against the URL it really used', async () => {
    const { seeOtherInApp } = await import('@/server/redirects');
    const res = seeOtherInApp('/account/bookings?payment=paid');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/account/bookings?payment=paid');
  });
  it('never points off-site', async () => {
    const { seeOtherInApp } = await import('@/server/redirects');
    for (const bad of ['//evil.example', 'https://evil.example/', '/\\evil.example'])
      expect(seeOtherInApp(bad).headers.get('location')).toBe('/dashboard');
  });
});
