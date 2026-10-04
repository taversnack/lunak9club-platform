import { describe, expect, it } from 'vitest';
import { bandFor, bookFor, priceDogDay, type PriceBook, type PriceInput } from '@/domain/pricing/engine';
import { changeEffectiveDate, membershipDates, validWeekdays } from '@/domain/membership/rules';

const book2026: PriceBook = {
  id: 'b2026',
  name: '2026',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  adHocFullPence: 5000,
  memberLowFullPence: 4800,
  memberHighFullPence: 4500,
  memberHighFromDays: 4,
  halfDayPercent: 50,
  taxiPence: 0,
  multiDogDiscountPercent: 0,
};
const book2027: PriceBook = {
  ...book2026,
  id: 'b2027',
  name: '2027',
  effectiveFrom: '2027-01-01',
  effectiveTo: null,
  adHocFullPence: 5200,
  memberLowFullPence: 5000,
  memberHighFullPence: 4700,
};
const books = [book2026, book2027];

const base = (o: Partial<PriceInput> = {}): PriceInput => ({
  date: '2026-10-05',
  session: 'full',
  taxi: false,
  dogId: 'dog1',
  membershipDaysPerWeek: null,
  dogIndexOnDate: 0,
  books,
  customerRates: [],
  ...o,
});

describe('pricing matrix (website prices, D3/D23)', () => {
  const cases: [string, Partial<PriceInput>, number, string][] = [
    ['ad hoc full day', {}, 5000, 'ad_hoc_full'],
    ['ad hoc morning', { session: 'am' }, 2500, 'ad_hoc_half'],
    ['ad hoc afternoon', { session: 'pm' }, 2500, 'ad_hoc_half'],
    ['member 1 day/week', { membershipDaysPerWeek: 1 }, 4800, 'member_low_full'],
    ['member 3 days/week', { membershipDaysPerWeek: 3 }, 4800, 'member_low_full'],
    ['member 4 days/week', { membershipDaysPerWeek: 4 }, 4500, 'member_high_full'],
    ['member 5 days/week', { membershipDaysPerWeek: 5 }, 4500, 'member_high_full'],
    ['member 1–3 half day', { membershipDaysPerWeek: 2, session: 'am' }, 2400, 'member_low_half'],
    ['member 4–5 half day', { membershipDaysPerWeek: 5, session: 'pm' }, 2250, 'member_high_half'],
    ['taxi is included', { taxi: true }, 5000, 'ad_hoc_full'],
    ['trial day, no band → ad hoc', { isTrial: true }, 5000, 'trial_ad_hoc_full'],
    ['trial day at 4–5 band', { isTrial: true, trialBand: 'high' }, 4500, 'trial_member_high_full'],
    [
      'trial day at 1–3 band even if a membership exists',
      { isTrial: true, trialBand: 'low', membershipDaysPerWeek: 5 },
      4800,
      'trial_member_low_full',
    ],
  ];
  for (const [name, input, pence, code] of cases) {
    it(name, () => {
      const p = priceDogDay(base(input));
      expect(p.totalPence).toBe(pence);
      expect(p.rateCode).toBe(code);
      expect(p.totalPence).toBe(p.basePence - p.discountPence + p.taxiPence);
    });
  }

  it('explains the price in plain words', () => {
    expect(priceDogDay(base({ membershipDaysPerWeek: 4, session: 'am', taxi: true })).explanation).toBe(
      '4–5 days a week rate (50% of £45.00), half day: £22.50; dog taxi included',
    );
    expect(priceDogDay(base()).explanation).toBe('Ad hoc rate, full day: £50.00');
  });
});

describe('effective dates', () => {
  it('uses the book in force on the booked date, not today', () => {
    expect(priceDogDay(base({ date: '2026-12-31' })).priceBookId).toBe('b2026');
    expect(priceDogDay(base({ date: '2027-01-04' }))).toMatchObject({ priceBookId: 'b2027', totalPence: 5200 });
  });
  it('fails loudly if no book covers a date', () => {
    expect(() => bookFor([book2026], '2027-01-04')).toThrow(/No price book/);
  });
  it('band threshold follows the book', () => {
    expect(bandFor(3, { memberHighFromDays: 3 })).toBe('high');
    expect(bandFor(3, book2026)).toBe('low');
  });
});

describe('customer-specific rates (D46)', () => {
  const rates = [
    {
      id: 'all',
      dogId: null,
      fullDayPence: 4000,
      halfDayPence: null,
      startsOn: '2026-10-01',
      endsOn: null,
      reason: 'Staff',
    },
    {
      id: 'rex',
      dogId: 'dog1',
      fullDayPence: 3500,
      halfDayPence: 2000,
      startsOn: '2026-10-01',
      endsOn: '2026-10-31',
      reason: 'Rescue',
    },
  ];
  it('dog-specific beats customer-wide, which beats membership', () => {
    expect(priceDogDay(base({ customerRates: rates, membershipDaysPerWeek: 5 }))).toMatchObject({
      totalPence: 3500,
      customerRateId: 'rex',
    });
    expect(priceDogDay(base({ customerRates: rates, dogId: 'dog2', membershipDaysPerWeek: 5 }))).toMatchObject({
      totalPence: 4000,
      customerRateId: 'all',
    });
  });
  it('uses the agreed half-day price, or the half-day percentage if none', () => {
    expect(priceDogDay(base({ customerRates: rates, session: 'am' })).totalPence).toBe(2000);
    expect(priceDogDay(base({ customerRates: rates, dogId: 'dog2', session: 'am' })).totalPence).toBe(2000);
  });
  it('respects start and end dates', () => {
    expect(priceDogDay(base({ customerRates: rates, date: '2026-11-02' })).customerRateId).toBe('all');
    expect(priceDogDay(base({ customerRates: rates, date: '2026-09-30' })).customerRateId).toBeNull();
  });
});

describe('multi-dog discount (off by default, D4)', () => {
  it('is zero with the seed book', () => {
    expect(priceDogDay(base({ dogIndexOnDate: 1 })).discountPence).toBe(0);
  });
  it('applies to the second dog when configured', () => {
    const b = { ...book2026, multiDogDiscountPercent: 10 };
    const p = priceDogDay(base({ dogIndexOnDate: 1, books: [b] }));
    expect(p).toMatchObject({ basePence: 5000, discountPence: 500, totalPence: 4500 });
    expect(p.explanation).toContain('multi-dog discount 10%');
  });
  it('rounds half pennies up', () => {
    const b = { ...book2026, adHocFullPence: 4999, halfDayPercent: 50 };
    expect(priceDogDay(base({ session: 'am', books: [b] })).totalPence).toBe(2500);
  });
});

describe('membership rules (D48)', () => {
  it('changes on the 1st of next month if asked by the 20th', () => {
    expect(changeEffectiveDate('2026-10-20')).toBe('2026-11-01');
    expect(changeEffectiveDate('2026-10-21')).toBe('2026-12-01');
    expect(changeEffectiveDate('2026-12-05')).toBe('2027-01-01');
    expect(changeEffectiveDate('2026-12-25')).toBe('2027-02-01');
  });
  it('lists the weekdays in a range', () => {
    expect(membershipDates([1, 3], '2026-09-28', '2026-10-09')).toEqual([
      '2026-09-28',
      '2026-09-30',
      '2026-10-05',
      '2026-10-07',
    ]);
  });
  it('validates chosen days', () => {
    expect(validWeekdays([], [1, 2, 3, 4, 5])).toMatch(/at least one/);
    expect(validWeekdays([6], [1, 2, 3, 4, 5])).toMatch(/not open/);
    expect(validWeekdays([1, 1], [1, 2, 3, 4, 5])).toMatch(/once/);
    expect(validWeekdays([1, 5], [1, 2, 3, 4, 5])).toBeNull();
  });
});
