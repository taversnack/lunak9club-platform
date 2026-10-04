import { addDays, londonDate, londonInstant, type IsoDate } from '../time';

/** YYYY-MM */
export type Month = string;

export type BillingSchedule = {
  draftDay: number;
  sendDay: number;
  sendTime: string;
  paymentTermsDays: number;
  reminderAfterDays: number;
  reminderTime: string;
};

export const monthOf = (date: IsoDate): Month => date.slice(0, 7);

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

export function monthRange(month: Month): { first: IsoDate; last: IsoDate } {
  const first = `${month}-01`;
  return { first, last: addDays(`${addMonths(month, 1)}-01`, -1) };
}

export function formatMonth(month: Month): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}

/**
 * Months whose member days are billed right now (D24, D52): last month (late catch-up), this month
 * (joining part-month, D19) and, from the draft day onwards, next month.
 */
export function billingMonths(today: IsoDate, s: Pick<BillingSchedule, 'draftDay'>): Month[] {
  const current = monthOf(today);
  const months = [addMonths(current, -1), current];
  if (Number(today.slice(8, 10)) >= s.draftDay) months.push(addMonths(current, 1));
  return months;
}

/**
 * When an approved invoice goes out (D24): invoices for a future month wait until the send day
 * of the month before, at the send time; anything else (joining, catch-up) goes immediately.
 */
export function sendTimeFor(period: Month, now: Date, s: Pick<BillingSchedule, 'sendDay' | 'sendTime'>): Date {
  const current = monthOf(londonDate(now));
  if (period <= current) return now;
  const before = addMonths(period, -1);
  const at = londonInstant(`${before}-${String(s.sendDay).padStart(2, '0')}`, s.sendTime);
  return at > now ? at : now;
}

/** Due date and reminder time for an invoice issued at `issuedAt` (D24, D25). */
export function paymentDates(
  issuedAt: Date,
  s: Pick<BillingSchedule, 'paymentTermsDays' | 'reminderAfterDays' | 'reminderTime'>,
) {
  const issueDate = londonDate(issuedAt);
  return {
    issueDate,
    dueDate: addDays(issueDate, s.paymentTermsDays),
    reminderDueAt: londonInstant(addDays(issueDate, s.reminderAfterDays), s.reminderTime),
  };
}

/** Document numbers: prefix + running number, at least two digits (LK9DOUGIE-01 … LK9DOUGIE-100). */
export function formatDocumentNumber(prefix: string, n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error('Document numbers start at 1');
  return `${prefix}${String(n).padStart(2, '0')}`;
}

export const creditNotePrefix = (invoicePrefix: string) => `${invoicePrefix}CN-`;

export type Balance = {
  totalPence: number;
  creditedPence: number;
  paidPence: number;
  /** What the customer still owes (never negative). */
  duePence: number;
  /** Paid more than is now owed (because of credits): must be refunded. */
  overpaidPence: number;
};

export function balanceOf(totalPence: number, creditedPence: number, paidPence: number): Balance {
  const net = totalPence - creditedPence - paidPence;
  return {
    totalPence,
    creditedPence,
    paidPence,
    duePence: Math.max(0, net),
    overpaidPence: Math.max(0, -net),
  };
}

/** How much of a new credit must go back to the card because it had already been paid. */
export function refundDueForCredit(before: Balance, creditPence: number): number {
  const after = balanceOf(before.totalPence, before.creditedPence + creditPence, before.paidPence);
  return Math.min(creditPence, after.overpaidPence - before.overpaidPence);
}

export type PaymentState = 'draft' | 'scheduled' | 'unpaid' | 'overdue' | 'part_paid' | 'paid' | 'void';

export function paymentState(
  inv: { status: string; dueDate: IsoDate | null },
  bal: Balance,
  today: IsoDate,
): PaymentState {
  if (inv.status === 'draft') return 'draft';
  if (inv.status === 'scheduled') return 'scheduled';
  if (inv.status === 'void') return 'void';
  if (bal.duePence === 0) return 'paid';
  if (inv.dueDate && today > inv.dueDate) return 'overdue';
  return bal.paidPence > 0 ? 'part_paid' : 'unpaid';
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  draft: 'Draft',
  scheduled: 'Approved – waiting to send',
  unpaid: 'Unpaid',
  overdue: 'Overdue',
  part_paid: 'Part paid',
  paid: 'Paid',
  void: 'Cancelled (credited)',
};

/** The invoice status once money or credits change. */
export function statusAfter(bal: Balance): 'issued' | 'paid' | 'void' {
  if (bal.duePence > 0) return 'issued';
  return bal.paidPence === 0 && bal.creditedPence >= bal.totalPence ? 'void' : 'paid';
}

const SESSION_TEXT: Record<string, string> = { full: 'Full day', am: 'Morning', pm: 'Afternoon' };

export function lineDescription(dogName: string, date: IsoDate, session: string, taxi: boolean): string {
  const d = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T00:00:00Z`));
  return `${dogName} – ${SESSION_TEXT[session] ?? session}, ${d}${taxi ? ' (with taxi)' : ''}`;
}
