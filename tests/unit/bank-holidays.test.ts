import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays, londonDate } from '@/domain/time';
import { isoWeekday } from '@/domain/booking/rules';

/**
 * England & Wales bank holidays are seeded into the `closures` table by migrations (there's no list in
 * the app). Customers can book 90 days ahead, so if the seeded list ends, bank holidays after that
 * date become bookable. This fails a year before that can happen, as a reminder to add the next
 * years' dates (from https://www.gov.uk/bank-holidays) in a new migration.
 */
function seededClosureDates(): string[] {
  const dates: string[] = [];
  for (const f of readdirSync('drizzle').filter((x) => x.endsWith('.sql'))) {
    // Drop SQL comments so dates mentioned in them don't count.
    const sql = readFileSync(`drizzle/${f}`, 'utf8').replace(/--.*$/gm, '');
    for (const stmt of sql.match(/INSERT INTO closures[\s\S]*?(?:;|$)/gi) ?? [])
      dates.push(...(stmt.match(/\d{4}-\d{2}-\d{2}/g) ?? []));
  }
  return [...new Set(dates)].sort();
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Gregorian Easter Sunday (Meeus/Jones/Butcher algorithm). */
function easterSunday(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - Math.floor(b / 4) - g + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return iso(y, Math.floor(n / 31), (n % 31) + 1);
}

/**
 * The standing England & Wales rules (no one-off holidays): New Year's Day, Good Friday, Easter Monday,
 * first and last Monday in May, last Monday in August, Christmas Day and Boxing Day, with weekend days
 * moved to the next free weekday (substitute days).
 */
function ruleBankHolidays(y: number): string[] {
  const firstMonday = (m: number) => {
    let d = iso(y, m, 1);
    while (isoWeekday(d) !== 1) d = addDays(d, 1);
    return d;
  };
  const lastMonday = (m: number) => {
    let d = addDays(iso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1), -1);
    while (isoWeekday(d) !== 1) d = addDays(d, -1);
    return d;
  };
  const easter = easterSunday(y);
  const out = [addDays(easter, -2), addDays(easter, 1), firstMonday(5), lastMonday(5), lastMonday(8)];
  const taken = new Set(out);
  for (const fixed of [iso(y, 1, 1), iso(y, 12, 25), iso(y, 12, 26)]) {
    let d = fixed;
    while (isoWeekday(d) > 5 || taken.has(d)) d = addDays(d, 1);
    taken.add(d);
    out.push(d);
  }
  return out.sort();
}

describe('seeded bank holidays', () => {
  const dates = seededClosureDates();

  it('are all weekdays (a closure on a weekend means a wrong date)', () => {
    expect(dates.length).toBeGreaterThan(10);
    for (const d of dates) expect(isoWeekday(d), d).toBeLessThanOrEqual(5);
  });

  it('match the standing rules (incl. substitute days) for every fully seeded year', () => {
    const years = [...new Set(dates.map((d) => Number(d.slice(0, 4))))];
    // The first seeded year may be partial (0005 starts at Christmas 2026).
    for (const y of years.slice(1))
      expect(
        dates.filter((d) => d.startsWith(`${y}-`)),
        String(y),
      ).toEqual(ruleBankHolidays(y));
  });

  it('reach at least a year past today, so customers can never book an unlisted bank holiday', () => {
    const last = dates.at(-1)!;
    const needed = addDays(londonDate(new Date()), 365);
    expect(
      last >= needed,
      `Bank holidays are only seeded up to ${last}. Add the next years' dates in a new migration (see drizzle/0005_seed_booking_settings_and_bank_holidays.sql).`,
    ).toBe(true);
  });
});
