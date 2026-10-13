import Stripe from 'stripe';
import type { CheckoutRequest, CheckoutState, PaymentProvider, RefundResult, WebhookEvent } from './types';

/** Stripe Checkout in GBP. Only ever constructed with a verified key (see ./index.ts). */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string | undefined,
  ) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  }

  async createCheckout(req: CheckoutRequest) {
    const s = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        currency: 'gbp',
        line_items: [
          {
            quantity: 1,
            price_data: { currency: 'gbp', unit_amount: req.amountPence, product_data: { name: req.description } },
          },
        ],
        customer_email: req.customerEmail,
        client_reference_id: req.reference,
        metadata: { attemptId: req.reference },
        payment_intent_data: { metadata: { attemptId: req.reference }, description: req.description },
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        expires_at: Math.floor(req.expiresAt.getTime() / 1000),
      },
      { idempotencyKey: `checkout-${req.reference}` },
    );
    if (!s.url) throw new Error('Stripe returned no checkout URL');
    return { id: s.id, url: s.url };
  }

  private state(s: Stripe.Checkout.Session): CheckoutState {
    return {
      id: s.id,
      status: s.status === 'complete' ? 'complete' : s.status === 'expired' ? 'expired' : 'open',
      paid: s.payment_status === 'paid',
      amountPence: s.amount_total ?? 0,
      paymentId: typeof s.payment_intent === 'string' ? s.payment_intent : (s.payment_intent?.id ?? null),
    };
  }

  async getCheckout(id: string): Promise<CheckoutState> {
    try {
      return this.state(await this.stripe.checkout.sessions.retrieve(id));
    } catch (err) {
      // A session Stripe has no record of (e.g. one made with test keys before going live) can never
      // be paid: report it expired, as the simulated provider does, so its hold is released.
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing')
        return { id, status: 'expired', paid: false, amountPence: 0, paymentId: null };
      throw err;
    }
  }

  async expireCheckout(id: string) {
    const current = await this.getCheckout(id);
    if (current.status !== 'open') return current;
    try {
      return this.state(await this.stripe.checkout.sessions.expire(id));
    } catch {
      // Completed between the two calls: report the real state.
      return this.getCheckout(id);
    }
  }

  async refund(
    paymentId: string,
    amountPence: number,
    idempotencyKey: string,
    reference: string,
    attempt = 1,
  ): Promise<RefundResult> {
    try {
      // An earlier attempt may have created the refund even though we never got the answer (e.g. a
      // timeout), and Stripe forgets idempotency keys after about 24 hours, so look for it first.
      const r =
        (await this.findRefund(paymentId, reference)) ??
        (await this.stripe.refunds.create(
          {
            payment_intent: paymentId,
            amount: amountPence,
            reason: 'requested_by_customer',
            metadata: { cardRefundId: reference, attempt: String(attempt) },
          },
          { idempotencyKey },
        ));
      return {
        id: r.id,
        status:
          r.status === 'succeeded'
            ? 'succeeded'
            : r.status === 'failed' || r.status === 'canceled'
              ? 'failed'
              : 'pending',
        failureReason: r.failure_reason ?? undefined,
      };
    } catch (err) {
      // Only a definite rejection is a failure. Timeouts, connection, rate-limit and Stripe-side
      // errors leave the outcome unknown: report it as pending so the refund is tried again later
      // (same idempotency key, and findRefund stops a second refund).
      const rejected =
        err instanceof Stripe.errors.StripeCardError || err instanceof Stripe.errors.StripeInvalidRequestError;
      const reason = err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 200) : 'unknown';
      return { id: '', status: rejected ? 'failed' : 'pending', failureReason: reason };
    }
  }

  /** Our refund on this payment that hasn't failed. A failed or cancelled one is never reused. */
  private async findRefund(paymentId: string, reference: string): Promise<Stripe.Refund | null> {
    for await (const r of this.stripe.refunds.list({ payment_intent: paymentId, limit: 100 }))
      if (r.metadata?.cardRefundId === reference && r.status !== 'failed' && r.status !== 'canceled') return r;
    return null;
  }

  parseWebhook(rawBody: string, signature: string | null): WebhookEvent {
    if (!this.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    if (!signature) throw new Error('Missing Stripe-Signature header');
    const e = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const obj = e.data.object as { id: string; status?: string; metadata?: Record<string, string> | null };
    const refundStatus =
      e.type.startsWith('refund.') && obj.status
        ? obj.status === 'succeeded'
          ? 'succeeded'
          : obj.status === 'failed' || obj.status === 'canceled'
            ? 'failed'
            : 'pending'
        : undefined;
    const refundReference = e.type.startsWith('refund.') ? obj.metadata?.cardRefundId : undefined;
    const attempt = e.type.startsWith('refund.') ? Number(obj.metadata?.attempt) : NaN;
    return {
      id: e.id,
      type: e.type,
      objectId: obj.id,
      refundStatus,
      refundReference,
      ...(Number.isInteger(attempt) && attempt > 0 ? { refundAttempt: attempt } : {}),
    };
  }
}
