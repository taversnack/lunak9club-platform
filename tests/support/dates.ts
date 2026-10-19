import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDatabaseUrl } from './test-db-url';
import { addDays, londonDate } from '@/domain/time';
import { isoWeekday } from '@/domain/booking/rules';

/**
 * Days the club is closed for bank holidays, read from the same migration that seeds them, so the
 * tests can never disagree with the app (and no list is repeated in each test file).
 */
export const BANK_HOLIDAYS: ReadonlySet<string> = new Set(
  readFileSync('drizzle/0005_seed_booking_settings_and_bank_holidays.sql', 'utf8').match(/\d{4}-\d{2}-\d{2}/g) ?? [],
);

/** The customers' booking window (booking_settings.max_advance_days default). */
export const BOOKING_WINDOW_DAYS = 90;

/**
 * The test files share one database, so a day one file has booked or closed can break another that picks
 * it too. Every pick is noted in a ledger (one line per day, reset at the start of each run) so later
 * picks prefer days nobody has taken. There are fewer open weekdays in the booking window than days the
 * files want, so as a last resort a day is shared rather than failing.
 */
const ledgerPath = () =>
  join(tmpdir(), `lunak9-test-days-${new URL(testDatabaseUrl()).pathname.slice(1).replace(/\W/g, '_')}.txt`);
export function resetDayLedger() {
  rmSync(ledgerPath(), { force: true });
}
function claimedDays(): Set<string> {
  try {
    return new Set(readFileSync(ledgerPath(), 'utf8').split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * A picker for open weekdays at least `n` days from today: never a weekend or bank holiday, never one
 * it has already handed out (when `unique`), and, unless `beyondWindow`, always inside the customers'
 * booking window. It throws, rather than quietly returning an unbookable date, if the window has run out.
 * "Today" is read when called, so it follows a pinned clock.
 */
export function weekdayPicker(opts: { base?: number; unique?: boolean; beyondWindow?: boolean } = {}) {
  const used = new Set<string>();
  const last = BOOKING_WINDOW_DAYS - 3; // slack: a late-evening start can't push it over
  return (n: number): string => {
    const today = londonDate(new Date());
    let offset = n + (opts.base ?? 0);
    const claimed = claimedDays();
    const open = (o: number) => {
      const d = addDays(today, o);
      return isoWeekday(d) <= 5 && !BANK_HOLIDAYS.has(d) && !(opts.unique !== false && used.has(d));
    };
    const start = offset;
    while (!open(offset) || claimed.has(addDays(today, offset))) {
      offset += 1;
      if (!opts.beyondWindow && offset > last) {
        // Nothing unclaimed left: share a day, but still never an unbookable one.
        offset = start;
        while (!open(offset)) offset += 1;
        break;
      }
    }
    if (!opts.beyondWindow && offset > last)
      throw new Error(`No open weekday left inside the ${BOOKING_WINDOW_DAYS}-day booking window (asked for +${n}).`);
    const d = addDays(today, offset);
    used.add(d);
    appendFileSync(ledgerPath(), `${d}\n`);
    return d;
  };
}

/** The first open weekday at least `n` days from today (a day other files may share). */
export function firstOpenWeekday(n: number): string {
  const today = londonDate(new Date());
  let d = addDays(today, n);
  while (isoWeekday(d) > 5 || BANK_HOLIDAYS.has(d)) d = addDays(d, 1);
  return d;
}
