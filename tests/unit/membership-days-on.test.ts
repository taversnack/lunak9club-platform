import { describe, expect, it } from 'vitest';
import { membershipDaysOn, type PricingContext } from '@/server/services/pricing';

const ctx = (list: { from: string; to: string | null; daysPerWeek: number }[]) =>
  ({ books: [], rates: [], memberships: new Map([['dog', list]]) }) as unknown as PricingContext;

describe('membershipDaysOn', () => {
  it('uses the replacement on a day it overlaps the membership it replaced', () => {
    // Old 4-day membership that hadn't started is kept to its first day (2 Nov); the 2-day one starts 1 Nov.
    const c = ctx([
      { from: '2026-11-02', to: '2026-11-02', daysPerWeek: 4 },
      { from: '2026-11-01', to: null, daysPerWeek: 2 },
    ]);
    expect(membershipDaysOn(c, 'dog', '2026-11-02')).toBe(2);
  });
  it('still uses an ended membership on its own days, and null outside any', () => {
    const c = ctx([
      { from: '2026-10-01', to: '2026-10-31', daysPerWeek: 4 },
      { from: '2026-11-01', to: null, daysPerWeek: 2 },
    ]);
    expect(membershipDaysOn(c, 'dog', '2026-10-15')).toBe(4);
    expect(membershipDaysOn(c, 'dog', '2026-11-15')).toBe(2);
    expect(membershipDaysOn(c, 'dog', '2026-09-15')).toBeNull();
  });
});
