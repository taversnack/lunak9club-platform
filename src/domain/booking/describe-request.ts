import { formatPounds } from './rules';
import { formatUkDate } from '../time';

export type BookingRequestSummary = {
  bookingDogIds: readonly string[];
  kind: 'standard' | 'trial';
  totalPence: number;
  dogNames?: readonly string[];
  dates?: readonly string[];
};

const listOf = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * "Biscuit: Day care on 4 November 2026 · 1 dog-day · £50.00", naming the dogs and dates like the
 * membership summaries do. Used in the approval emails (approved, declined, withdrawn, expired) and
 * the approvals list. Requests saved before names and dates were stored keep the short form.
 */
export function describeBookingRequest(p: BookingRequestSummary): string {
  const n = p.bookingDogIds.length;
  const what = p.kind === 'trial' ? 'Trial day' : 'Day care';
  const tail = `${n} ${n === 1 ? 'dog-day' : 'dog-days'} · ${formatPounds(p.totalPence)}`;
  const dates = [...new Set(p.dates ?? [])].sort();
  const names = [...new Set(p.dogNames ?? [])];
  const when = !dates.length
    ? ''
    : dates.length === 1
      ? ` on ${formatUkDate(dates[0]!)}`
      : ` on ${dates.length} days, ${formatUkDate(dates[0]!)} to ${formatUkDate(dates.at(-1)!)}`;
  return `${names.length ? `${listOf(names)}: ` : ''}${what}${when} · ${tail}`;
}
