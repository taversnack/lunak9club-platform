import { describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { StripePaymentProvider } from '@/infra/payments/stripe';

/** A provider whose Stripe client is a stub: no network. */
function provider(refunds: { create?: unknown; list?: unknown }, webhookSecret?: string) {
  const p = new StripePaymentProvider('sk_test_stub', webhookSecret);
  const none = async function* () {};
  (p as unknown as { stripe: { refunds: unknown } }).stripe.refunds = { list: vi.fn(none), ...refunds };
  return p;
}
const raw = { message: 'boom' };

describe('Stripe refunds (M1)', () => {
  it('tags the refund with our id and an idempotency key', async () => {
    const create = vi.fn(async () => ({ id: 're_1', status: 'succeeded', failure_reason: null }));
    const res = await provider({ create }).refund('pi_1', 500, 'refund-abc', 'abc');
    expect(res).toEqual({ id: 're_1', status: 'succeeded', failureReason: undefined });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_1', amount: 500, metadata: { cardRefundId: 'abc' } }),
      { idempotencyKey: 'refund-abc' },
    );
  });

  it('only a definite rejection is a failure; timeouts and Stripe-side errors stay pending', async () => {
    const throwing = (err: Error) => ({
      create: vi.fn(async () => {
        throw err;
      }),
    });
    for (const err of [
      new Stripe.errors.StripeConnectionError(raw),
      new Stripe.errors.StripeAPIError(raw),
      new Stripe.errors.StripeRateLimitError(raw),
      new Error('socket hang up'),
    ])
      expect((await provider(throwing(err)).refund('pi_1', 500, 'k', 'abc')).status).toBe('pending');
    for (const err of [new Stripe.errors.StripeCardError(raw), new Stripe.errors.StripeInvalidRequestError(raw)])
      expect(await provider(throwing(err)).refund('pi_1', 500, 'k', 'abc')).toMatchObject({ id: '', status: 'failed' });
  });

  it('finds a refund an earlier attempt created instead of refunding again', async () => {
    const create = vi.fn();
    const list = vi.fn(async function* () {
      yield { id: 're_other', status: 'succeeded', metadata: { cardRefundId: 'zzz' } };
      yield { id: 're_mine', status: 'pending', metadata: { cardRefundId: 'abc' } };
    });
    const res = await provider({ create, list }).refund('pi_1', 500, 'refund-abc', 'abc');
    expect(res).toMatchObject({ id: 're_mine', status: 'pending' });
    expect(create).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({ payment_intent: 'pi_1', limit: 100 });
  });

  it('reads our id back from refund webhooks', () => {
    const secret = 'whsec_test_secret';
    const payload = JSON.stringify({
      id: 'evt_1',
      object: 'event',
      type: 'refund.updated',
      data: { object: { id: 're_1', object: 'refund', status: 'succeeded', metadata: { cardRefundId: 'abc' } } },
    });
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(provider({}, secret).parseWebhook(payload, header)).toEqual({
      id: 'evt_1',
      type: 'refund.updated',
      objectId: 're_1',
      refundStatus: 'succeeded',
      refundReference: 'abc',
    });
  });
});
