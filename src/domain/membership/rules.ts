import { addDays, type IsoDate } from '../time';
import { isoWeekday } from '../booking/rules';

/** Membership date rules (D47, D48). */

/** Changes and leaving take effect on the 1st of next month if asked by the 20th, else the 1st after (D19/D48). */
export function changeEffectiveDate(today: IsoDate): IsoDate {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const monthsAhead = d <= 20 ? 1 : 2;
  const total = y * 12 + (m - 1) + monthsAhead;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}

/** Dates in [from, to] that fall on the membership's weekdays. */
export function membershipDates(weekdays: readonly number[], from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.includes(isoWeekday(d))) out.push(d);
  return out;
}

export function validWeekdays(weekdays: readonly number[], openWeekdays: readonly number[]): string | null {
  if (!weekdays.length) return 'Choose at least one day';
  if (new Set(weekdays).size !== weekdays.length) return 'Each day can only be chosen once';
  if (weekdays.some((w) => !openWeekdays.includes(w))) return 'We’re not open on one of the days you chose';
  return null;
}

// ---- Membership workflow (D86–D90) -----------------------------------------------------------

/**
 * D89: a change to "all future months" starts on the 1st of the first month after this one that
 * has no membership invoice yet (drafts don't count – they are rebuilt from the new days).
 * `invoicedMonths` are the customer's months ('YYYY-MM') with a non-draft membership invoice.
 */
export function firstUninvoicedMonthStart(today: IsoDate, invoicedMonths: readonly string[]): IsoDate {
  const done = new Set(invoicedMonths);
  let [y, m] = today.split('-').map(Number) as [number, number];
  for (let i = 0; i < 36; i++) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (!done.has(month)) return `${month}-01`;
  }
  throw new Error('No uninvoiced month in the next three years');
}

/** D88: the date by which a month's days should be confirmed, e.g. ('2026-11', 1) → 2026-11-01. */
export function confirmByDate(month: string, confirmByDay: number): IsoDate {
  return `${month}-${String(confirmByDay).padStart(2, '0')}`;
}

/** D94: a confirmation made after the month's confirm-by date is accepted but marked late. */
export function isLateConfirmation(month: string, confirmByDay: number, confirmedOn: IsoDate): boolean {
  return confirmedOn > confirmByDate(month, confirmByDay);
}

/**
 * D90: a one-off move is a straight swap inside the same month (same session, taxi and price).
 * Returns the reason it isn't allowed, or null. Notice and space are checked by the caller.
 */
export function moveOnceProblem(from: IsoDate, to: IsoDate, today: IsoDate): string | null {
  if (to === from) return 'Choose a different day';
  if (to <= today) return 'Choose a day from tomorrow onwards';
  if (from.slice(0, 7) !== to.slice(0, 7)) return 'A one-off move must stay in the same month';
  return null;
}
