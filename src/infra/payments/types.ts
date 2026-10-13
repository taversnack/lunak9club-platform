/** What the app needs from a card payment provider (Stripe in production, simulated otherwise). */
export type CheckoutRequest = {
  /** Our checkout_attempts.id – sent as the reference and metadata. */
  reference: string;
  amountPence: number;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  expiresAt: Date;
};

export type CheckoutState = {
  id: string;
  status: 'open' | 'complete' | 'expired';
  paid: boolean;
  amountPence: number;
  /** Stripe PaymentIntent id once paid. */
  paymentId: string | null;
};

/**
 * `failed` means the provider definitely rejected the refund. `pending` with an empty id means the
 * outcome is unknown (timeout, connection or provider error): the refund may or may not exist.
 */
export type RefundResult = {
  id: string;
  status: 'succeeded' | 'pending' | 'failed';
  failureReason?: string;
  /**
   * The provider refused us rather than the refund (wrong or revoked API key, missing permission).
   * Nothing was created, and trying again won't help until the Owner fixes the account settings.
   */
  needsOwner?: boolean;
};

export type WebhookEvent = {
  id: string;
  type: string;
  /** Checkout session id for checkout.* events; refund id for refund.* events. */
  objectId: string;
  refundStatus?: RefundResult['status'];
  /** refund.* events: our card_refunds.id, from the refund's metadata. */
  refundReference?: string;
};

export interface PaymentProvider {
  readonly name: 'stripe' | 'simulated';
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  getCheckout(id: string): Promise<CheckoutState>;
  /** Stop an open checkout so it can't be paid. Returns the final state (it may already be complete). */
  expireCheckout(id: string): Promise<CheckoutState>;
  /** `reference` is our card_refunds.id, stored on the provider's refund so it can be found again. */
  refund(paymentId: string, amountPence: number, idempotencyKey: string, reference: string): Promise<RefundResult>;
  /** Verify the signature and parse. Throws if the signature is wrong. */
  parseWebhook(rawBody: string, signature: string | null): WebhookEvent;
}
