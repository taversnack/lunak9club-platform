import { StatusBadge } from './components';
import { PAYMENT_STATE_LABELS, type PaymentState } from '@/domain/billing/rules';

const TONE: Record<PaymentState, 'info' | 'success' | 'warning' | 'danger'> = {
  draft: 'info',
  scheduled: 'info',
  unpaid: 'warning',
  part_paid: 'warning',
  overdue: 'danger',
  paid: 'success',
  void: 'info',
};

/** Invoice state as an icon + words (never colour alone). */
export function InvoiceState({ state }: { state: PaymentState }) {
  return <StatusBadge tone={TONE[state]}>{PAYMENT_STATE_LABELS[state]}</StatusBadge>;
}
