import { describe, expect, it, vi } from 'vitest';
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

describe('Stripe checkout creation', () => {
  it('offers card only, so no delayed method (e.g. Bacs) can outlast the 24-hour hold', async () => {
    const p = new StripePaymentProvider('sk_test_stub', undefined);
    const create = vi.fn(async () => ({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }));
    (p as unknown as { stripe: { checkout: unknown } }).stripe.checkout = { sessions: { create } };
    await p.createCheckout({
      reference: 'att_1',
      amountPence: 5000,
      description: 'Booking',
      customerEmail: 'a@example.test',
      successUrl: 'https://app.test/ok',
      cancelUrl: 'https://app.test/cancel',
      expiresAt: new Date(Date.now() + 3600_000),
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ payment_method_types: ['card'] }), {
      idempotencyKey: 'checkout-att_1',
    });
  });
});
