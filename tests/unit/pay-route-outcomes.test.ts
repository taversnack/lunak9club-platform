/**
 * Pay-link routes (pay-booking/[bookingId] and pay/[attemptId]): which bookings page notice each
 * service outcome lands on. A link whose places have gone comes back from the service as
 * `?payment=expired` (no error); a card-service failure is PayLinkUnavailableError →
 * `?payment=unavailable`. Any other conflict also lands on that notice, never a server error page. The
 * notice's wording is neutral (it doesn't say the places are held), as it covers both cases.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({ next: null as null | (() => unknown) }));

vi.mock('@/server/session', () => ({ getActor: async () => ({ kind: 'user', userId: 'u1', roles: ['customer'] }) }));
vi.mock('@/infra/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/server/services/payments', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/services/payments')>();
  const run = async () => service.next!();
  return { ...real, payForMyBooking: run, resumeCheckoutUrl: run };
});

beforeAll(() => {
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  vi.stubEnv('DATABASE_URL', 'postgres://unused:unused@127.0.0.1:1/unused');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-test-secret-test-secret-000');
  vi.stubEnv('APP_ENV', 'test');
});
beforeEach(() => {
  service.next = null;
});

type Get = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ID = '0b8f3c1e-9d1a-4c39-9a51-2a8f1c3d4e5f';
const routes = [
  [
    'pay-booking/[bookingId]',
    async () => (await import('@/app/api/payments/pay-booking/[bookingId]/route')).GET as unknown as Get,
    { bookingId: ID },
  ],
  [
    'pay/[attemptId]',
    async () => (await import('@/app/api/payments/pay/[attemptId]/route')).GET as unknown as Get,
    { attemptId: ID },
  ],
] as const;

const call = async (load: () => Promise<Get>, params: Record<string, string>) =>
  (await load())(new Request(`http://localhost:3000/api/payments/x/${ID}`), { params: Promise.resolve(params) });

describe.each(routes)('%s', (_label, load, params) => {
  it('card service down → ?payment=unavailable', async () => {
    const { PayLinkUnavailableError } = await import('@/server/services/payments');
    service.next = () => {
      throw new PayLinkUnavailableError('10:00 on Monday 2 November');
    };
    const res = await call(load, params);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/account/bookings?payment=unavailable');
  });

  it('places released (the service says expired) → ?payment=expired', async () => {
    service.next = () => ({ url: null, reason: 'expired', to: '/account/bookings?payment=expired' });
    const res = await call(load, params);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/account/bookings?payment=expired');
  });

  it('checkout being created by another click → ?payment=preparing', async () => {
    const { PayLinkBusyError } = await import('@/server/services/payments');
    service.next = () => {
      throw new PayLinkBusyError();
    };
    expect((await call(load, params)).headers.get('location')).toBe('/account/bookings?payment=preparing');
  });

  it('any other conflict shows the neutral "couldn’t take your payment" notice, not a server error', async () => {
    const { ConflictError } = await import('@/server/errors');
    service.next = () => {
      throw new ConflictError('something else');
    };
    const res = await call(load, params);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/account/bookings?payment=unavailable');
  });

  it('errors that aren’t conflicts are still not swallowed', async () => {
    service.next = () => {
      throw new Error('database down');
    };
    await expect(call(load, params)).rejects.toThrow('database down');
  });
});
