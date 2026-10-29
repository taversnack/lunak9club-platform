import { formatPounds } from './rules';
import { addDays, formatUkDate, type IsoDate } from '../time';
import { SUMMARY_MAX } from '../approvals/rules';

export type BookingRequestSummary = {
  bookingDogIds: readonly string[];
  kind: 'standard' | 'trial';
  totalPence: number;
  dogNames?: readonly string[];
  dates?: readonly string[];
};

const listOf = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** "16, 18 and 20 November 2026", "30 November and 2 December 2026": month and year said once per run. */
function listDates(dates: readonly IsoDate[]): string {
  return listOf(
    dates.map((d, i) => {
      const next = dates[i + 1];
      const full = formatUkDate(d);
      if (next && next.slice(0, 7) === d.slice(0, 7)) return full.split(' ')[0]!;
      if (next && next.slice(0, 4) === d.slice(0, 4)) return full.split(' ').slice(0, 2).join(' ');
      return full;
    }),
  );
}

function datePhrases(dates: readonly IsoDate[]): string[] {
  if (!dates.length) return [''];
  if (dates.length === 1) return [` on ${formatUkDate(dates[0]!)}`];
  const first = formatUkDate(dates[0]!);
  const last = formatUkDate(dates.at(-1)!);
  const consecutive = dates.every((d, i) => i === 0 || addDays(dates[i - 1]!, 1) === d);
  if (consecutive) return [` on ${dates.length} days, ${first} to ${last}`];
  // Not consecutive: list the dates; if that's too long, say how many days fall between which dates.
  return [` on ${listDates(dates)}`, ` on ${dates.length} days between ${first} and ${last}`];
}

/** Names that fit in `room` characters: all of them, then "A, B and 3 more", then one shortened name. */
function fitNames(names: readonly string[], room: number): string {
  const all = listOf(names);
  if (all.length <= room) return all;
  for (let keep = names.length - 1; keep >= 1; keep--) {
    const s = `${names.slice(0, keep).join(', ')} and ${names.length - keep} more`;
    if (s.length <= room) return s;
  }
  const more = names.length > 1 ? ` and ${names.length - 1} more` : '';
  return `${names[0]!.slice(0, Math.max(1, room - more.length - 1))}…${more}`;
}

/**
 * "Biscuit: Day care on 4 November 2026 · 1 dog-day · £50.00", naming the dogs and dates like the
 * membership summaries do. Used in the approval emails (approved, declined, withdrawn, expired) and
 * the approvals list. Kept within SUMMARY_MAX by shortening the dates, then the names, so the
 * dog-days and price at the end are never cut. Requests saved before names and dates were stored
 * keep the short form.
 */
export function describeBookingRequest(p: BookingRequestSummary): string {
  const n = p.bookingDogIds.length;
  const what = p.kind === 'trial' ? 'Trial day' : 'Day care';
  const tail = ` · ${n} ${n === 1 ? 'dog-day' : 'dog-days'} · ${formatPounds(p.totalPence)}`;
  const dates = [...new Set(p.dates ?? [])].sort() as IsoDate[];
  const names = [...new Set((p.dogNames ?? []).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const phrases = datePhrases(dates);
  // Shorten the dates first (when the full names and full dates don't fit together), then the names.
  const namesRoom = names.length ? listOf(names).length + 2 : 0;
  const when = phrases.find((w) => namesRoom + `${what}${w}${tail}`.length <= SUMMARY_MAX) ?? phrases.at(-1)!;
  const body = `${what}${when}${tail}`;
  if (!names.length) return body;
  return `${fitNames(names, SUMMARY_MAX - body.length - 2)}: ${body}`;
}
