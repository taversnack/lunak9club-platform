import { describe, expect, it } from 'vitest';
import { checkStripeKey } from '@/infra/payments';
import { SimulatedPaymentProvider } from '@/infra/payments/simulated';

describe('Stripe keys (non-negotiable 7)', () => {
  it('accepts test keys anywhere and live keys only in production', () => {
    expect(checkStripeKey('sk_test_abc123', 'development')).toBe('test');
    expect(checkStripeKey('rk_test_abc123', 'test')).toBe('test');
    expect(() => checkStripeKey('sk_live_abc123', 'development')).toThrow(/live/);
    expect(() => checkStripeKey('sk_live_abc123', 'test')).toThrow(/live/);
    expect(checkStripeKey('sk_live_abc123', 'production')).toBe('live');
    expect(() => checkStripeKey('pk_test_abc123', 'development')).toThrow(/does not look/);
    expect(() => checkStripeKey('', 'development')).toThrow();
  });
});

describe('simulated provider', () => {
  const p = new SimulatedPaymentProvider('http://localhost:3000');
  const req = {
    reference: 'a1',
    amountPence: 5000,
    description: 'Day care',
    customerEmail: 'x@example.test',
    successUrl: 'http://localhost:3000/ok',
    cancelUrl: 'http://localhost:3000/no',
  };

  it('pays once, then reports complete', async () => {
    const s = await p.createCheckout({ ...req, expiresAt: new Date(Date.now() + 60_000) });
    expect(s.url).toBe(`http://localhost:3000/dev/checkout/${s.id}`);
    expect((await p.getCheckout(s.id)).status).toBe('open');
    expect(p.pay(s.id)).not.toBeNull();
    expect(p.pay(s.id)).toBeNull();
    expect(await p.getCheckout(s.id)).toMatchObject({ status: 'complete', paid: true, amountPence: 5000 });
    expect((await p.expireCheckout(s.id)).status).toBe('complete');
  });

  it('can’t be paid once expired', async () => {
    const s = await p.createCheckout({ ...req, expiresAt: new Date(Date.now() - 1) });
    expect((await p.getCheckout(s.id)).status).toBe('expired');
    expect(p.pay(s.id)).toBeNull();
  });

  it('refunds are idempotent by key', async () => {
    const a = await p.refund('pi_1', 100, 'k1');
    const b = await p.refund('pi_1', 100, 'k1');
    expect(a.id).toBe(b.id);
    expect(p.refunds.filter((r) => r.key === 'k1')).toHaveLength(1);
  });
});
