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

/**
 * Names that fit in `room` characters: all of them, then "A, B and 3 more", then one shortened name.
 * `kept` is how many names are shown in full.
 */
function fitNames(names: readonly string[], room: number): { text: string; kept: number } {
  const all = listOf(names);
  if (all.length <= room) return { text: all, kept: names.length };
  for (let keep = names.length - 1; keep >= 1; keep--) {
    const s = `${names.slice(0, keep).join(', ')} and ${names.length - keep} more`;
    if (s.length <= room) return { text: s, kept: keep };
  }
  const more = names.length > 1 ? ` and ${names.length - 1} more` : '';
  return { text: `${names[0]!.slice(0, Math.max(1, room - more.length - 1))}…${more}`, kept: 0 };
}

/**
 * "Biscuit: Day care on 4 November 2026 · 1 dog-day · £50.00", naming the dogs and dates like the
 * membership summaries do. Used in the approval emails (approved, declined, withdrawn, expired) and
 * the approvals list. Kept within SUMMARY_MAX so the dog-days and price at the end are never cut:
 * the dates are shortened only when that lets more names be shown in full (or, when no name fits in
 * full, more of the first name), then the names are cut. Requests saved before names and dates were stored
 * keep the short form.
 */
export function describeBookingRequest(p: BookingRequestSummary): string {
  const n = p.bookingDogIds.length;
  const what = p.kind === 'trial' ? 'Trial day' : 'Day care';
  const tail = ` · ${n} ${n === 1 ? 'dog-day' : 'dog-days'} · ${formatPounds(p.totalPence)}`;
  const dates = [...new Set(p.dates ?? [])].sort() as IsoDate[];
  const names = [...new Set((p.dogNames ?? []).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const phrases = datePhrases(dates);
  const bodies = phrases.map((w) => `${what}${w}${tail}`);
  if (!names.length) return bodies.find((b) => b.length <= SUMMARY_MAX) ?? bodies.at(-1)!;
  // The fullest dates that fit, unless shorter dates let more names be shown in full: names are
  // only cut as a last resort, but the dates are only shortened when that actually saves a name.
  let best: { text: string; kept: number; body: string } | null = null;
  for (const body of bodies) {
    const room = SUMMARY_MAX - body.length - 2;
    if (room < 1) continue;
    const fit = fitNames(names, room);
    // When no name fits in full either way, the dates that leave more of the name win (#108 F1).
    const better =
      !best || fit.kept > best.kept || (fit.kept === 0 && best.kept === 0 && fit.text.length > best.text.length);
    if (better) best = { ...fit, body };
  }
  if (!best) {
    const body = bodies.at(-1)!;
    best = { ...fitNames(names, SUMMARY_MAX - body.length - 2), body };
  }
  return `${best.text}: ${best.body}`;
}
