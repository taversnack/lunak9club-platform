import { describe, expect, it } from 'vitest';
import { balanceOf, refundDueForCredit } from '@/domain/billing/rules';
import { priceDogDay, type PriceBook, type PriceInput } from '@/domain/pricing/engine';

describe('credits and refunds at the edges (D54, D58)', () => {
  // £96.00 invoice, £60.00 paid: £36.00 still owed.
  const part = (credited = 0) => balanceOf(9600, credited, 6000);

  it('a credit up to what is still owed needs no refund; every penny beyond it goes back', () => {
    expect(refundDueForCredit(part(), 3599)).toBe(0);
    expect(refundDueForCredit(part(), 3600)).toBe(0); // exactly what was owed
    expect(refundDueForCredit(part(), 3601)).toBe(1); // one penny over
    expect(refundDueForCredit(part(), 4800)).toBe(1200);
  });

  it('an unpaid invoice never needs a refund; a fully paid one refunds the whole credit', () => {
    expect(refundDueForCredit(balanceOf(9600, 0, 0), 9600)).toBe(0);
    expect(refundDueForCredit(balanceOf(9600, 0, 9600), 1)).toBe(1);
    expect(refundDueForCredit(balanceOf(9600, 0, 9600), 9600)).toBe(9600);
  });

  it('a second credit refunds only what the first left over, so the total refunded never exceeds what was paid', () => {
    const first = refundDueForCredit(part(0), 4800); // £48 of £36 owed → £12 back
    expect(first).toBe(1200);
    const second = refundDueForCredit(part(4800), 4800);
    expect(second).toBe(4800);
    expect(first + second).toBeLessThanOrEqual(6000); // the £60 paid
    expect(first + second).toBe(6000); // and all of it comes back once the invoice is fully credited
  });

  it('holds for every combination on a grid: refund is never negative, never more than the credit, and the sum over credits never passes the amount paid', () => {
    for (const total of [1, 99, 4800, 9600, 62400])
      for (const paid of [0, 1, total - 1, total].filter((p) => p >= 0 && p <= total)) {
        for (const steps of [[total], [Math.ceil(total / 2), Math.floor(total / 2)], [1, total - 1]]) {
          let credited = 0;
          let refunded = 0;
          for (const credit of steps) {
            if (credit <= 0) continue;
            const r = refundDueForCredit(balanceOf(total, credited, paid), credit);
            expect(r).toBeGreaterThanOrEqual(0);
            expect(r).toBeLessThanOrEqual(credit);
            credited += credit;
            refunded += r;
          }
          expect(refunded).toBeLessThanOrEqual(paid);
          if (credited === total) expect(refunded).toBe(paid); // fully credited: everything paid goes back
        }
      }
  });
});

describe('price rounding (integer pence, half a penny rounds up)', () => {
  const book: PriceBook = {
    id: 'b',
    name: 'b',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    adHocFullPence: 5000,
    memberLowFullPence: 4800,
    memberHighFullPence: 4500,
    memberHighFromDays: 4,
    halfDayPercent: 50,
    taxiPence: 0,
    multiDogDiscountPercent: 0,
  };
  const input = (o: Partial<PriceInput>): PriceInput => ({
    date: '2026-10-05',
    session: 'full',
    taxi: false,
    dogId: 'd',
    membershipDaysPerWeek: null,
    dogIndexOnDate: 0,
    books: [book],
    customerRates: [],
    ...o,
  });

  it('a half penny rounds up for the half-day share and the multi-dog discount', () => {
    expect(priceDogDay(input({ session: 'am', books: [{ ...book, adHocFullPence: 4801 }] })).totalPence).toBe(2401); // 2400.5
    const withDiscount = priceDogDay(
      input({ dogIndexOnDate: 1, books: [{ ...book, adHocFullPence: 4995, multiDogDiscountPercent: 10 }] }),
    );
    expect(withDiscount).toMatchObject({ basePence: 4995, discountPence: 500, totalPence: 4495 }); // 499.5 → 500
  });

  it('every price comes out in whole pence, never negative, discount never above the price', () => {
    for (const pence of [1, 2, 3, 99, 4499, 4500, 4801, 4999, 5000, 5201])
      for (const percent of [0, 1, 10, 33, 50, 99, 100])
        for (const session of ['full', 'am'] as const) {
          const p = priceDogDay(
            input({
              session,
              dogIndexOnDate: 1,
              books: [{ ...book, adHocFullPence: pence, halfDayPercent: 50, multiDogDiscountPercent: percent }],
            }),
          );
          for (const v of [p.basePence, p.discountPence, p.taxiPence, p.totalPence])
            expect(Number.isInteger(v)).toBe(true);
          expect(p.totalPence).toBeGreaterThanOrEqual(0);
          expect(p.discountPence).toBeLessThanOrEqual(p.basePence);
          expect(p.totalPence).toBe(p.basePence - p.discountPence + p.taxiPence);
        }
  });
});
