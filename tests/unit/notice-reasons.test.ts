import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cancelledAheadReason, noticeHoursText, refundApprovedReason } from '@/domain/booking/rules';

describe('refund and credit-note reasons name the configured notice period', () => {
  it.each([24, 72, 48])('%i hours', (hours) => {
    expect(cancelledAheadReason('Biscuit', hours)).toBe(`Cancelled ${hours} hours or more ahead: Biscuit`);
    expect(refundApprovedReason('Biscuit on Tue 3 Nov', hours)).toBe(
      `Refund: Biscuit on Tue 3 Nov cancelled ${hours} hours or more ahead`,
    );
    for (const t of [cancelledAheadReason('Rex', hours), refundApprovedReason('Rex on Mon 2 Nov', hours)])
      if (hours !== 48) expect(t).not.toContain('48');
  });
  it('says "1 hour", not "1 hours"', () => {
    expect(noticeHoursText(1)).toBe('1 hour');
    expect(cancelledAheadReason('Rex', 1)).toContain('1 hour or more');
  });
  it('the services build the text from the setting, never a literal 48 (guard for new records)', () => {
    for (const file of ['src/server/services/bookings.ts', 'src/server/services/billing.ts']) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/(cancelled|Cancelled) 48 hours/);
    }
    expect(readFileSync('src/server/services/bookings.ts', 'utf8')).toContain(
      'cancelledAheadReason(dogName, settings.freeCancellationHours)',
    );
    expect(readFileSync('src/server/services/billing.ts', 'utf8')).toContain(
      'refundApprovedReason(dayText, noticeHours)',
    );
  });
});
