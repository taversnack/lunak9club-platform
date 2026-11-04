import { describe, expect, it } from 'vitest';
import { paymentState, type PaymentFacts } from '@/domain/booking/payment-state';

const f = (o: Partial<PaymentFacts> = {}): PaymentFacts => ({
  status: 'confirmed',
  lateCancellation: false,
  invoiceStatus: 'paid',
  creditRefundState: null,
  refundRequestStatus: null,
  ...o,
});

describe('paymentState', () => {
  it('is none when nothing has been invoiced or paid (requests, holds, lapsed holds, drafts)', () => {
    expect(paymentState(f({ invoiceStatus: null, status: 'pending_payment' }))).toBe('none');
    expect(paymentState(f({ invoiceStatus: null, status: 'cancelled' }))).toBe('none');
    expect(paymentState(f({ invoiceStatus: 'draft' }))).toBe('none');
    expect(paymentState(f({ invoiceStatus: 'scheduled' }))).toBe('none');
  });
  it('is paid for a paid day that stands, none while its invoice is unpaid', () => {
    expect(paymentState(f())).toBe('paid');
    expect(paymentState(f({ status: 'attended' }))).toBe('paid');
    expect(paymentState(f({ invoiceStatus: 'issued' }))).toBe('none');
  });
  it('follows a credit note: refunded, on its way, or credited with no money moved', () => {
    expect(paymentState(f({ status: 'cancelled', creditRefundState: 'refunded' }))).toBe('refunded');
    expect(paymentState(f({ status: 'cancelled', creditRefundState: 'awaiting_refund' }))).toBe('refund_requested');
    expect(paymentState(f({ status: 'cancelled', invoiceStatus: 'issued', creditRefundState: 'none' }))).toBe(
      'credited',
    );
  });
  it('shows a member-day refund request as waiting, and a declined one as charged', () => {
    expect(paymentState(f({ status: 'cancelled', refundRequestStatus: 'requested' }))).toBe('refund_requested');
    expect(paymentState(f({ status: 'cancelled', refundRequestStatus: 'declined' }))).toBe('charged_no_refund');
  });
  it('a late cancellation or a no-show stays charged, paid or not yet paid', () => {
    expect(paymentState(f({ status: 'cancelled', lateCancellation: true }))).toBe('charged_no_refund');
    expect(paymentState(f({ status: 'cancelled', lateCancellation: true, invoiceStatus: 'issued' }))).toBe(
      'charged_no_refund',
    );
    expect(paymentState(f({ status: 'no_show' }))).toBe('charged_no_refund');
  });
  it('an approved request without a credit note yet is not reported as refunded', () => {
    expect(paymentState(f({ status: 'cancelled', refundRequestStatus: 'approved' }))).toBe('paid');
  });
});
