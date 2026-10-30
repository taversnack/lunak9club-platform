import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { StripePaymentProvider } from '@/infra/payments/stripe';

// The real Stripe signature check (no network, no real keys). Built from parts so secret scanners
// don't mistake these fakes for real credentials.
const KEY = ['sk', 'test', 'stub'].join('_');
const SECRET = ['whsec', 'unit', 'test', 'secret'].join('_');
const OTHER = ['whsec', 'some', 'other', 'secret'].join('_');

const event = {
  id: 'evt_sig_1',
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_1', object: 'checkout.session' } },
};
const body = JSON.stringify(event);

function header(payload: string, secret: string, timestamp?: number) {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
    ...(timestamp ? { timestamp } : {}),
  });
}

describe('Stripe webhook signature (non-negotiable 3)', () => {
  const provider = new StripePaymentProvider(KEY, SECRET);

  it('accepts a correctly signed event and reads its id, type and object', () => {
    expect(provider.parseWebhook(body, header(body, SECRET))).toMatchObject({
      id: 'evt_sig_1',
      type: 'checkout.session.completed',
      objectId: 'cs_test_1',
    });
  });

  it('rejects a body changed after signing', () => {
    const tampered = body.replace('cs_test_1', 'cs_test_2');
    expect(() => provider.parseWebhook(tampered, header(body, SECRET))).toThrow(/signature/i);
  });

  it('rejects a signature made with another secret', () => {
    expect(() => provider.parseWebhook(body, header(body, OTHER))).toThrow(/signature/i);
  });

  it('rejects a replayed event outside the 5 minute tolerance', () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(() => provider.parseWebhook(body, header(body, SECRET, old))).toThrow(/tolerance|timestamp/i);
  });

  it('rejects a missing or garbage header', () => {
    expect(() => provider.parseWebhook(body, null)).toThrow(/Stripe-Signature/);
    expect(() => provider.parseWebhook(body, 'nonsense')).toThrow();
  });

  it('refuses everything when no webhook secret is configured, without echoing any value', () => {
    const open = new StripePaymentProvider(KEY, undefined);
    expect(() => open.parseWebhook(body, header(body, SECRET))).toThrow(/STRIPE_WEBHOOK_SECRET is not set/);
  });
});
