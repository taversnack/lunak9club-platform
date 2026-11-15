import { afterAll, describe, expect, it } from 'vitest';
import { addDays, londonDate } from '@/domain/time';
import { isoWeekday } from '@/domain/booking/rules';
import { BANK_HOLIDAYS, BOOKING_WINDOW_DAYS, resetDayLedger, weekdayPicker } from '../support/dates';

afterAll(() => resetDayLedger());

describe('weekdayPicker when the booking window runs out of free days', () => {
  it('keeps returning open weekdays inside the window (sharing days) instead of throwing', () => {
    resetDayLedger();
    const pick = weekdayPicker();
    const today = londonDate(new Date());
    const last = addDays(today, BOOKING_WINDOW_DAYS - 3);
    // Far more picks than there are open weekdays in the window.
    for (let i = 0; i < 150; i++) {
      const d = pick(40);
      expect(isoWeekday(d)).toBeLessThanOrEqual(5);
      expect(BANK_HOLIDAYS.has(d)).toBe(false);
      expect(d >= addDays(today, 40) && d <= last).toBe(true);
    }
  });
});
