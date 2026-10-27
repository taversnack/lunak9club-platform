import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { desc, eq } from 'drizzle-orm';
import type { Actor } from '@/server/policy/authorize';
import { closeDb, getDb } from '@/infra/db/client';
import { bookingDogs, checkoutAttempts, customers, payments } from '@/infra/db/schema';
import { setEmailProvider } from '@/infra/email/providers';
import { setPaymentProvider } from '@/infra/payments';
import { SimulatedPaymentProvider } from '@/infra/payments/simulated';
import type { PaymentProvider } from '@/infra/payments/types';
import { cancelMyBooking } from '@/server/services/bookings';
import { payForMyBooking, resumeCheckoutUrl } from '@/server/services/payments';
import { weekdayPicker } from '../support/dates';
import { requestAndApprove } from '../support/requests';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer } from '../support/onboard';

// The routes read the signed-in user through getActor; each test says who's signed in.
let signedIn: Actor = { kind: 'anonymous' };
vi.mock('@/server/session', () => ({ getActor: async () => signedIn }));

const { POST: payPOST } = await import('@/app/dev/checkout/[sessionId]/pay/route');
const { POST: cancelPOST } = await import('@/app/dev/checkout/[sessionId]/cancel/route');
const { GET: returnGET } = await import('@/app/api/payments/return/route');

const APP = 'http://localhost:3000'; // APP_URL in tests/support/integration-env.ts
const db = () => getDb();
const sim = new SimulatedPaymentProvider(APP);
const weekdayAhead = weekdayPicker();
let owner: TestUser;
let casey: TestUser;
let jordan: TestUser;
let caseyDog: string;

/** A new held booking for Casey with an open simulated checkout. */
async function caseyCheckout(daysAhead: number) {
  await requestAndApprove(
    db(),
    casey,
    { dogIds: [caseyDog], dates: [weekdayAhead(daysAhead)], session: 'full', taxi: false },
    owner,
  );
  const [a] = await db()
    .select({ a: checkoutAttempts })
    .from(checkoutAttempts)
    .innerJoin(customers, eq(customers.id, checkoutAttempts.customerId))
    .where(eq(customers.userId, casey.userId))
    .orderBy(desc(checkoutAttempts.createdAt))
    .limit(1)
    .then((r) => r.map((x) => x.a));
  return a!;
}

function post(route: typeof payPOST, sessionId: string, headers: Record<string, string>) {
  const req = new Request(`${APP}/dev/checkout/${sessionId}/pay`, { method: 'POST', headers });
  return route(req, { params: Promise.resolve({ sessionId }) });
}
const SAME = { origin: APP, 'sec-fetch-site': 'same-origin' };

beforeAll(async () => {
  setEmailProvider(new MemoryEmailProvider());
  setPaymentProvider(sim);
  owner = await makeUser(db(), 'owner', 'Oscar Owner');
  casey = await makeUser(db(), 'customer', 'Casey Card');
  jordan = await makeUser(db(), 'customer', 'Jordan Other');
  await readyCustomer(db(), casey);
  await readyCustomer(db(), jordan);
  caseyDog = await approvedDog(db(), owner, casey, 'Biscuit');
});
beforeEach(() => {
  signedIn = { kind: 'anonymous' };
});
afterAll(async () => {
  setEmailProvider(undefined);
  setPaymentProvider(undefined);
  await closeDb();
});

describe('simulated checkout buttons: same-origin only', () => {
  it.each([
    ['cross-site Origin', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }],
    ['cross-site Origin without Sec-Fetch-Site', { origin: 'https://evil.example' }],
    ['Origin "null"', { origin: 'null', 'sec-fetch-site': 'cross-site' }],
    ['no Origin, cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['no Origin, same-site (another subdomain)', { 'sec-fetch-site': 'same-site' }],
    ['no Origin, no Sec-Fetch-Site', {}],
    ['foreign Referer only', { referer: 'https://evil.example/page' }],
    ['look-alike Origin', { origin: 'http://localhost:3000.evil.example' }],
    // Contradictory headers: a foreign Origin wins over a claimed same-origin fetch.
    ['cross-site Origin claiming Sec-Fetch-Site same-origin', { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }],
    ['Origin "null" claiming Sec-Fetch-Site same-origin', { origin: 'null', 'sec-fetch-site': 'same-origin' }],
  ])('rejects %s with 403 and leaves the checkout unpaid', async (_name, headers) => {
    const a = await caseyCheckout(30);
    signedIn = casey; // even with the customer's own cookie
    for (const route of [payPOST, cancelPOST]) {
      const res = await post(route, a.providerSessionId!, headers);
      expect(res.status).toBe(403);
    }
    expect(sim.sessions.get(a.providerSessionId!)!.status).toBe('open');
  });

  it('accepts its own pages: Origin = APP_URL, or Sec-Fetch-Site same-origin', async () => {
    signedIn = casey;
    const a = await caseyCheckout(31);
    const res = await post(cancelPOST, a.providerSessionId!, { origin: APP });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${APP}/api/payments/return?attempt=${a.id}&cancelled=1`);
    const b = await post(cancelPOST, a.providerSessionId!, { 'sec-fetch-site': 'same-origin' });
    expect(b.status).toBe(303);
    expect(sim.sessions.get(a.providerSessionId!)!.status).toBe('open'); // cancel doesn't pay
  });
});

describe('simulated checkout buttons: only the customer whose checkout it is', () => {
  it('signed out (no cookie): 404, nothing paid', async () => {
    const a = await caseyCheckout(32);
    signedIn = { kind: 'anonymous' };
    for (const route of [payPOST, cancelPOST]) expect((await post(route, a.providerSessionId!, SAME)).status).toBe(404);
    expect(sim.sessions.get(a.providerSessionId!)!.status).toBe('open');
  });

  it('another customer, or the Owner: 404, nothing paid', async () => {
    const a = await caseyCheckout(33);
    for (const who of [jordan, owner]) {
      signedIn = who;
      for (const route of [payPOST, cancelPOST])
        expect((await post(route, a.providerSessionId!, SAME)).status).toBe(404);
    }
    expect(sim.sessions.get(a.providerSessionId!)!.status).toBe('open');
  });

  it('an unknown session: 404', async () => {
    signedIn = casey;
    expect((await post(payPOST, 'sim_cs_00000000-0000-0000-0000-000000000000', SAME)).status).toBe(404);
  });

  it('with Stripe (not the simulated driver): 404 for everyone', async () => {
    const a = await caseyCheckout(34);
    setPaymentProvider({ name: 'stripe' } as unknown as PaymentProvider); // the routes only check which driver
    try {
      signedIn = casey;
      for (const route of [payPOST, cancelPOST])
        expect((await post(route, a.providerSessionId!, SAME)).status).toBe(404);
    } finally {
      setPaymentProvider(sim);
    }
  });
});

describe('paying twice (replay or double-click)', () => {
  it('says "already paid" with the receipt, and records one payment', async () => {
    signedIn = casey;
    const a = await caseyCheckout(35);
    const first = await post(payPOST, a.providerSessionId!, SAME);
    expect(first.headers.get('location')).toBe(`${APP}/api/payments/return?attempt=${a.id}`);
    const firstReturn = await returnGET(new Request(first.headers.get('location')!));
    expect(firstReturn.headers.get('location')).toBe('/account/bookings?payment=paid');

    // The same button again, and a losing "Cancel": both end on "already paid", not "not finished".
    const again = await post(payPOST, a.providerSessionId!, SAME);
    expect(again.headers.get('location')).toBe(`${APP}/api/payments/return?attempt=${a.id}&again=1`);
    const lateCancel = await post(cancelPOST, a.providerSessionId!, SAME);
    const [paid] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, a.id));
    const alreadyPaid = `/account/bookings?payment=already-paid&receipt=${paid!.resultInvoiceId}`;
    for (const res of [again, lateCancel]) {
      const back = await returnGET(new Request(res.headers.get('location')!));
      expect(back.headers.get('location')).toBe(alreadyPaid);
    }
    const directCancelReturn = await returnGET(new Request(`${APP}/api/payments/return?attempt=${a.id}&cancelled=1`));
    expect(directCancelReturn.headers.get('location')).toBe(alreadyPaid);

    const rows = await db().select().from(payments).where(eq(payments.checkoutAttemptId, a.id));
    expect(rows).toHaveLength(1);
  });
});

describe('a double-click: parallel pay POSTs', () => {
  it('every one ends on the paid page (none on "not finished"), and one payment is recorded', async () => {
    signedIn = casey;
    const a = await caseyCheckout(37);
    const ok = `${APP}/api/payments/return?attempt=${a.id}`;
    const res = await Promise.all(Array.from({ length: 5 }, () => post(payPOST, a.providerSessionId!, SAME)));
    const locations = res.map((r) => r.headers.get('location'));
    expect(locations.filter((l) => l === ok)).toHaveLength(1);
    expect(locations.filter((l) => l === `${ok}&again=1`)).toHaveLength(4);
    for (const l of locations) {
      const back = await returnGET(new Request(l!));
      expect(back.headers.get('location')).toMatch(/^\/account\/bookings\?payment=(paid|already-paid&receipt=)/);
    }
    const rows = await db().select().from(payments).where(eq(payments.checkoutAttemptId, a.id));
    expect(rows).toHaveLength(1);
  });
});

describe('a pay link for a cancelled booking', () => {
  it('says it was cancelled, not that the time ran out', async () => {
    const a = await caseyCheckout(36);
    const [day] = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a.bookingId!));
    await cancelMyBooking(db(), casey, day!.id);
    const to = '/account/bookings?payment=booking-cancelled';
    expect(await payForMyBooking(db(), casey, a.bookingId!)).toMatchObject({ url: null, to });
    expect(await resumeCheckoutUrl(db(), casey, a.id)).toMatchObject({ url: null, to });
  });
});
