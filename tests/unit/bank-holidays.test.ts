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
    const sql = readFileSync(`drizzle/${f}`, 'utf8');
    for (const stmt of sql.match(/INSERT INTO closures[\s\S]*?(?:;|$)/gi) ?? [])
      dates.push(...(stmt.match(/\d{4}-\d{2}-\d{2}/g) ?? []));
  }
  return [...new Set(dates)].sort();
}

describe('seeded bank holidays', () => {
  const dates = seededClosureDates();

  it('are all weekdays (a closure on a weekend means a wrong date)', () => {
    expect(dates.length).toBeGreaterThan(10);
    for (const d of dates) expect(isoWeekday(d), d).toBeLessThanOrEqual(5);
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
