import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { StripePaymentProvider } from '@/infra/payments/stripe';

function provider(retrieve: () => Promise<unknown>) {
  const p = new StripePaymentProvider('sk_test_stub', undefined);
  (p as unknown as { stripe: { checkout: unknown } }).stripe.checkout = { sessions: { retrieve } };
  return p;
}

describe('Stripe checkout lookups (M2)', () => {
  it('reports a session Stripe has no record of as expired, so its hold can be released', async () => {
    const missing = new Stripe.errors.StripeInvalidRequestError({
      message: 'No such checkout.session',
      code: 'resource_missing',
    });
    expect(await provider(() => Promise.reject(missing)).getCheckout('cs_test_old')).toEqual({
      id: 'cs_test_old',
      status: 'expired',
      paid: false,
      amountPence: 0,
      paymentId: null,
    });
  });

  it('still throws for other errors (outage, bad request)', async () => {
    const down = new Stripe.errors.StripeConnectionError({ message: 'down' });
    await expect(provider(() => Promise.reject(down)).getCheckout('cs_1')).rejects.toBe(down);
    const bad = new Stripe.errors.StripeInvalidRequestError({ message: 'bad', code: 'parameter_invalid' });
    await expect(provider(() => Promise.reject(bad)).getCheckout('cs_1')).rejects.toBe(bad);
  });
});
