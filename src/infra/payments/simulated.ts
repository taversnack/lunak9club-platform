import { randomUUID } from 'node:crypto';
import type { CheckoutRequest, CheckoutState, PaymentProvider, RefundResult, WebhookEvent } from './types';

const SIMULATED_BRAND = Symbol.for('lk9.payments.simulated');

/**
 * Bundle-safe check for the simulated provider. The provider is cached on globalThis, so the
 * instance may come from another copy of this module (route handler vs page bundle); a global
 * Symbol brand works across copies where `instanceof` doesn't.
 */
export function isSimulatedProvider(p: unknown): p is SimulatedPaymentProvider {
  return typeof p === 'object' && p !== null && (p as Record<symbol, unknown>)[SIMULATED_BRAND] === true;
}

type Session = CheckoutRequest & { id: string; status: CheckoutState['status']; paymentId: string | null };

/**
 * A stand-in for Stripe used in development and tests (PAYMENTS_DRIVER=simulated). Sessions live
 * in memory; the "checkout page" is /dev/checkout/[id]. Never enabled in production (see env).
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name = 'simulated' as const;
  /** Brand checked by isSimulatedProvider – `instanceof` fails when Next bundles this module twice. */
  readonly [SIMULATED_BRAND] = true;
  readonly sessions = new Map<string, Session>();
  readonly refunds: {
    id: string;
    paymentId: string;
    amountPence: number;
    key: string;
    reference: string;
    attempt: number;
    status: 'succeeded' | 'failed';
  }[] = [];
  /** Tests can make the next refunds fail. */
  failRefunds = false;

  constructor(private readonly baseUrl: string) {}

  async createCheckout(req: CheckoutRequest) {
    const id = `sim_cs_${randomUUID()}`;
    this.sessions.set(id, { ...req, id, status: 'open', paymentId: null });
    return { id, url: `${this.baseUrl}/dev/checkout/${id}` };
  }

  private state(s: Session): CheckoutState {
    const expired = s.status === 'open' && s.expiresAt <= new Date();
    return {
      id: s.id,
      status: expired ? 'expired' : s.status,
      paid: s.status === 'complete',
      amountPence: s.amountPence,
      paymentId: s.paymentId,
    };
  }

  async getCheckout(id: string) {
    const s = this.sessions.get(id);
    if (!s) return { id, status: 'expired' as const, paid: false, amountPence: 0, paymentId: null };
    return this.state(s);
  }

  async expireCheckout(id: string) {
    const s = this.sessions.get(id);
    if (s && s.status === 'open') s.status = 'expired';
    return this.getCheckout(id);
  }

  /** What the simulated checkout page (and tests) call to "pay with a test card". */
  pay(id: string): Session | null {
    const s = this.sessions.get(id);
    if (!s || this.state(s).status !== 'open') return null;
    s.status = 'complete';
    s.paymentId = `sim_pi_${randomUUID()}`;
    return s;
  }

  async refund(
    paymentId: string,
    amountPence: number,
    key: string,
    reference: string,
    attempt = 1,
  ): Promise<RefundResult> {
    // Like Stripe: the same idempotency key gives back the same refund, and a refund for our id that
    // hasn't failed is found again rather than sent twice. A failed one is never reused.
    const existing =
      this.refunds.find((r) => r.key === key) ??
      this.refunds.find((r) => r.reference === reference && r.status !== 'failed');
    if (existing) return { id: existing.id, status: existing.status };
    if (this.failRefunds) return { id: '', status: 'failed', failureReason: 'Simulated refund failure' };
    const id = `sim_re_${randomUUID()}`;
    this.refunds.push({ id, paymentId, amountPence, key, reference, attempt, status: 'succeeded' });
    return { id, status: 'succeeded' };
  }

  /** Tests: the bank bounced a refund after it had gone through (Stripe's refund.failed). */
  failRefundLater(id: string) {
    const r = this.refunds.find((x) => x.id === id);
    if (r) r.status = 'failed';
  }

  parseWebhook(_rawBody: string, _signature: string | null): WebhookEvent {
    throw new Error('The simulated provider has no webhooks; checkouts are confirmed on return.');
  }
}
