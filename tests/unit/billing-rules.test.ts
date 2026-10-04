import { describe, expect, it } from 'vitest';
import {
  addMonths,
  balanceOf,
  billingMonths,
  creditNotePrefix,
  formatDocumentNumber,
  lineDescription,
  monthRange,
  paymentDates,
  paymentState,
  refundDueForCredit,
  sendTimeFor,
  statusAfter,
} from '@/domain/billing/rules';
import { londonInstant, londonTime } from '@/domain/time';
import { pdfSafe, registrationPlace } from '@/infra/pdf/invoice-pdf';

const S = {
  draftDay: 25,
  sendDay: 28,
  sendTime: '09:00',
  paymentTermsDays: 5,
  reminderAfterDays: 4,
  reminderTime: '15:30',
};

describe('months', () => {
  it('adds months across years and knows month lengths', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2027-01', -1)).toBe('2026-12');
    expect(monthRange('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(monthRange('2026-11').last).toBe('2026-11-30');
  });

  it('bills last and this month, and next month from the draft day (D24)', () => {
    expect(billingMonths('2026-10-24', S)).toEqual(['2026-09', '2026-10']);
    expect(billingMonths('2026-10-25', S)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(billingMonths('2026-12-31', S)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('send and payment times (D24, D25)', () => {
  it('holds next month’s invoice until the 28th at 09:00 London time (GMT and BST)', () => {
    const oct26 = londonInstant('2026-10-26', '10:00');
    const nov = sendTimeFor('2026-11', oct26, S);
    expect(nov.toISOString()).toBe('2026-10-28T09:00:00.000Z'); // GMT after the clocks go back
    const may = sendTimeFor('2026-06', londonInstant('2026-05-26', '10:00'), S);
    expect(may.toISOString()).toBe('2026-05-28T08:00:00.000Z'); // BST
  });

  it('sends straight away for this month (joining) and if approved after the send time', () => {
    const now = londonInstant('2026-10-29', '11:00');
    expect(sendTimeFor('2026-10', now, S)).toBe(now);
    expect(sendTimeFor('2026-11', now, S)).toBe(now);
  });

  it('is due 5 days after sending, with a reminder at 15:30 on day 4', () => {
    const d = paymentDates(londonInstant('2026-10-28', '09:00'), S);
    expect(d.issueDate).toBe('2026-10-28');
    expect(d.dueDate).toBe('2026-11-02');
    expect(londonTime(d.reminderDueAt)).toBe('15:30');
    expect(d.reminderDueAt.toISOString()).toBe('2026-11-01T15:30:00.000Z');
  });
});

describe('numbers', () => {
  it('formats LK9DOUGIE-01 … LK9DOUGIE-100 and credit notes', () => {
    expect(formatDocumentNumber('LK9DOUGIE-', 1)).toBe('LK9DOUGIE-01');
    expect(formatDocumentNumber('LK9DOUGIE-', 99)).toBe('LK9DOUGIE-99');
    expect(formatDocumentNumber('LK9DOUGIE-', 100)).toBe('LK9DOUGIE-100');
    expect(formatDocumentNumber(creditNotePrefix('LK9DOUGIE-'), 3)).toBe('LK9DOUGIE-CN-03');
    expect(() => formatDocumentNumber('X', 0)).toThrow();
  });
});

describe('balances, credits and refunds (D54, D55)', () => {
  it('works out what is still owed', () => {
    expect(balanceOf(62400, 4800, 0)).toMatchObject({ duePence: 57600, overpaidPence: 0 });
    expect(balanceOf(62400, 4800, 57600)).toMatchObject({ duePence: 0, overpaidPence: 0 });
  });

  it('a credit on an unpaid invoice needs no refund; on a paid one it does', () => {
    expect(refundDueForCredit(balanceOf(9600, 0, 0), 4800)).toBe(0);
    expect(refundDueForCredit(balanceOf(9600, 0, 9600), 4800)).toBe(4800);
    // Part paid: £96 invoice, £60 paid, credit £48 → owed drops to −£12 → £12 back.
    expect(refundDueForCredit(balanceOf(9600, 0, 6000), 4800)).toBe(1200);
  });

  it('status follows the money', () => {
    expect(statusAfter(balanceOf(9600, 0, 0))).toBe('issued');
    expect(statusAfter(balanceOf(9600, 0, 9600))).toBe('paid');
    expect(statusAfter(balanceOf(9600, 9600, 0))).toBe('void');
    expect(statusAfter(balanceOf(9600, 4800, 4800))).toBe('paid');
  });

  it('labels overdue only after the due date', () => {
    const inv = { status: 'issued', dueDate: '2026-11-02' };
    expect(paymentState(inv, balanceOf(9600, 0, 0), '2026-11-02')).toBe('unpaid');
    expect(paymentState(inv, balanceOf(9600, 0, 0), '2026-11-03')).toBe('overdue');
    expect(paymentState(inv, balanceOf(9600, 0, 100), '2026-11-01')).toBe('part_paid');
    expect(paymentState(inv, balanceOf(9600, 0, 9600), '2026-12-01')).toBe('paid');
  });
});

describe('invoice text', () => {
  it('describes a day plainly', () => {
    expect(lineDescription('Pepper', '2026-11-02', 'full', true)).toBe('Pepper – Full day, Mon 2 Nov (with taxi)');
    expect(lineDescription('Pepper', '2026-11-03', 'am', false)).toBe('Pepper – Morning, Tue 3 Nov');
  });

  it('never breaks the PDF on characters the standard font can’t draw', () => {
    expect(pdfSafe('Luna’s K9 Club – £48 🐶')).toBe('Luna’s K9 Club – £48 ?');
  });

  it('prints the place of registration from the company number', () => {
    expect(registrationPlace('12345678')).toBe('England and Wales');
    expect(registrationPlace('SC123456')).toBe('Scotland');
    expect(registrationPlace('NI123456')).toBe('Northern Ireland');
  });
});
