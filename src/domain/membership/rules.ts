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
