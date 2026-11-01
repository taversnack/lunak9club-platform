import { afterAll, afterEach, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { count } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { auditEvents, webhookEvents } from '@/infra/db/schema';
import { setPaymentProvider } from '@/infra/payments';
import { StripePaymentProvider } from '@/infra/payments/stripe';
import { SimulatedPaymentProvider } from '@/infra/payments/simulated';
import { POST } from '@/app/api/webhooks/stripe/route';

// The route with the real Stripe signature check (no network, fake keys built from parts so secret
// scanners don't mistake them for real ones). A webhook that can't be verified must get a 4xx (so
// Stripe stops retrying it) and write nothing.
const KEY = ['sk', 'test', 'stub'].join('_');
const SECRET = ['whsec', 'route', 'test', 'secret'].join('_');
const OTHER = ['whsec', 'some', 'other', 'secret'].join('_');
const body = JSON.stringify({
  id: 'evt_route_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_route_1', object: 'checkout.session' } },
});
const sign = (payload: string, secret: string, timestamp?: number) =>
  Stripe.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });
const post = (payload: string, signature?: string) =>
  POST(
    new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: payload,
      headers: signature ? { 'stripe-signature': signature } : {},
    }),
  );
const written = async () => {
  const [w] = await getDb().select({ n: count() }).from(webhookEvents);
  const [a] = await getDb().select({ n: count() }).from(auditEvents);
  return { webhooks: w!.n, audit: a!.n };
};

afterEach(() => setPaymentProvider(undefined));
afterAll(async () => {
  await closeDb();
});

describe('POST /api/webhooks/stripe', () => {
  it.each([
    [
      'a stale timestamp (replay outside the 5 minute tolerance)',
      () => sign(body, SECRET, Math.floor(Date.now() / 1000) - 3600),
    ],
    ['a signature made with another secret', () => sign(body, OTHER)],
    ['a body changed after signing', () => sign(body.replace('cs_route_1', 'cs_route_2'), SECRET)],
    ['a garbage header', () => 'nonsense'],
    ['no header', () => undefined],
  ])('rejects %s with 400 and writes nothing', async (_what, header) => {
    setPaymentProvider(new StripePaymentProvider(KEY, SECRET));
    const before = await written();
    const res = await post(body, header());
    expect(res.status).toBe(400);
    expect(await res.text()).toBe('Invalid signature');
    expect(await written()).toEqual(before);
  });

  it('rejects everything with 400 when no webhook secret is configured', async () => {
    setPaymentProvider(new StripePaymentProvider(KEY, undefined));
    const before = await written();
    const res = await post(body, sign(body, SECRET));
    expect(res.status).toBe(400);
    expect(await written()).toEqual(before);
  });

  it('still answers 500 (so Stripe retries) when something other than verification fails', async () => {
    class Broken extends SimulatedPaymentProvider {
      override parseWebhook(): never {
        throw new Error('database is down');
      }
    }
    setPaymentProvider(new Broken('http://localhost:3000'));
    const res = await post(body, sign(body, SECRET));
    expect(res.status).toBe(500);
  });
});
