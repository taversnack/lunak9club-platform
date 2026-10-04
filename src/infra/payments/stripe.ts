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

  async getCheckout(id: string) {
    return this.state(await this.stripe.checkout.sessions.retrieve(id));
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

  async refund(paymentId: string, amountPence: number, idempotencyKey: string): Promise<RefundResult> {
    try {
      const r = await this.stripe.refunds.create(
        { payment_intent: paymentId, amount: amountPence, reason: 'requested_by_customer' },
        { idempotencyKey },
      );
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
      return { id: '', status: 'failed', failureReason: err instanceof Error ? err.message.slice(0, 200) : 'unknown' };
    }
  }

  parseWebhook(rawBody: string, signature: string | null): WebhookEvent {
    if (!this.webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    if (!signature) throw new Error('Missing Stripe-Signature header');
    const e = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    const obj = e.data.object as { id: string; status?: string };
    const refundStatus =
      e.type.startsWith('refund.') && obj.status
        ? obj.status === 'succeeded'
          ? 'succeeded'
          : obj.status === 'failed' || obj.status === 'canceled'
            ? 'failed'
            : 'pending'
        : undefined;
    return { id: e.id, type: e.type, objectId: obj.id, refundStatus };
  }
}
