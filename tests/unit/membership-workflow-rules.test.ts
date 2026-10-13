import { describe, expect, it } from 'vitest';
import { confirmByDate, firstUninvoicedMonthStart, moveOnceProblem } from '@/domain/membership/rules';
import { membershipFaqs, ordinal } from '@/domain/membership/faq';

describe('firstUninvoicedMonthStart (D89)', () => {
  it('is next month when nothing is invoiced', () => {
    expect(firstUninvoicedMonthStart('2026-10-13', [])).toBe('2026-11-01');
  });
  it('skips invoiced months and crosses the year', () => {
    expect(firstUninvoicedMonthStart('2026-11-20', ['2026-12'])).toBe('2027-01-01');
    expect(firstUninvoicedMonthStart('2026-10-13', ['2026-11', '2026-12'])).toBe('2027-01-01');
  });
  it('ignores the current month even if not invoiced', () => {
    expect(firstUninvoicedMonthStart('2026-10-01', ['2026-09'])).toBe('2026-11-01');
  });
});

describe('confirmByDate (D88)', () => {
  it('pads the day', () => {
    expect(confirmByDate('2026-11', 1)).toBe('2026-11-01');
    expect(confirmByDate('2026-11', 28)).toBe('2026-11-28');
  });
});

describe('moveOnceProblem (D90)', () => {
  const today = '2026-10-13';
  it('allows a same-month future swap', () => {
    expect(moveOnceProblem('2026-10-20', '2026-10-22', today)).toBeNull();
  });
  it('refuses the same day, past days and another month', () => {
    expect(moveOnceProblem('2026-10-20', '2026-10-20', today)).toMatch(/different day/);
    expect(moveOnceProblem('2026-10-20', '2026-10-13', today)).toMatch(/tomorrow/);
    expect(moveOnceProblem('2026-10-30', '2026-11-02', today)).toMatch(/same month/);
  });
});

describe('membership FAQ (D91)', () => {
  const faqs = membershipFaqs({ freeCancellationHours: 48, sendDay: 28, paymentTermsDays: 5, confirmByDay: 1 });
  it('has the four key questions using the settings', () => {
    expect(faqs.map((f) => f.id)).toEqual(['cancel', 'change', 'extra', 'invoices']);
    expect(faqs[0]!.answer).toContain('48 hours');
    expect(faqs[3]!.answer).toContain('28th');
    expect(faqs[3]!.answer).toContain('5 days');
    expect(faqs[3]!.answer).toContain('1st of the month');
  });
  it('contains no personal or sensitive wording', () => {
    for (const f of faqs) expect(f.answer).not.toMatch(/vaccin|medical|vet|password/i);
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '28th',
    ]);
  });
});
