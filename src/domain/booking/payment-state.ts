/**
 * What happened to the money for one booking day, for the customer's timeline. Derived from rows we
 * already keep (invoice line, credit note, refund request); never exposes ids, amounts or provider details.
 *
 * - none: nothing paid or charged (a request, a held place, a lapsed hold, a day not yet invoiced or paid)
 * - paid: paid for, and still standing
 * - refund_requested: a refund is waiting for the Owner, or approved and on its way to the customer
 * - refunded: the money went back to the customer
 * - credited: the day was credited off an invoice that was not yet paid, so nothing was taken (no money moved)
 * - charged_no_refund: stays charged: a late cancellation, a no-show, or a declined refund request
 */
export type PaymentState = 'none' | 'paid' | 'refund_requested' | 'refunded' | 'credited' | 'charged_no_refund';

export type PaymentFacts = {
  status: string;
  lateCancellation: boolean;
  /** The invoice line for this day (null if it was never invoiced or paid for). */
  invoiceStatus: string | null;
  /** The credit note covering this day's line, if any. */
  creditRefundState: 'none' | 'awaiting_refund' | 'refunded' | null;
  /** The member-day refund request for this day, if any. */
  refundRequestStatus: 'requested' | 'approved' | 'declined' | null;
};

export function paymentState(f: PaymentFacts): PaymentState {
  const invoiced = f.invoiceStatus === 'issued' || f.invoiceStatus === 'paid';
  if (!invoiced) return 'none';
  if (f.creditRefundState === 'refunded') return 'refunded';
  if (f.creditRefundState === 'awaiting_refund') return 'refund_requested';
  if (f.creditRefundState === 'none') return 'credited';
  if (f.refundRequestStatus === 'requested') return 'refund_requested';
  if (f.refundRequestStatus === 'declined') return 'charged_no_refund';
  if ((f.status === 'cancelled' && f.lateCancellation) || f.status === 'no_show') return 'charged_no_refund';
  return f.invoiceStatus === 'paid' ? 'paid' : 'none';
}
