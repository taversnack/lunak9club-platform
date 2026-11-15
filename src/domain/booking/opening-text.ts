import type { IsoDate } from '../time';

/** Words for the days the Owner has set as open (booking_settings.open_weekdays, ISO: 1 = Monday … 7 = Sunday). */
const NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const joinWords = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/** "Monday to Friday", "Monday to Saturday", "Monday, Wednesday and Friday". Empty if no day is open. */
export function openDaysText(openWeekdays: readonly number[]): string {
  const days = [...new Set(openWeekdays)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (!days.length) return '';
  const contiguous = days.length >= 3 && days.every((d, i) => i === 0 || d === days[i - 1]! + 1);
  return contiguous ? `${NAMES[days[0]!]} to ${NAMES[days.at(-1)!]}` : joinWords(days.map((d) => NAMES[d]!));
}

/**
 * The sentence about closed days for the Book page: the weekdays that are not open plus bank holidays, e.g.
 * "Weekends and bank holidays are closed." when Monday to Friday is open, "Sundays and bank holidays are closed."
 * when Monday to Saturday is. Never says a day is closed that the Owner has opened.
 */
export function closedDaysText(openWeekdays: readonly number[]): string {
  const open = new Set(openWeekdays);
  const closed = [1, 2, 3, 4, 5, 6, 7].filter((d) => !open.has(d));
  const weekend = closed.length === 2 && closed.includes(6) && closed.includes(7);
  const names = weekend ? ['Weekends'] : closed.map((d) => `${NAMES[d]}s`);
  const sentence = `${joinWords([...names, 'bank holidays'])} are closed.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export type { IsoDate };
