import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeBookingRequest } from '@/domain/booking/describe-request';
import { approvalDecisionMessage, paymentLinkMessage } from '@/infra/email/templates';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);

describe('booking request summary (decline / withdrawn emails, Tester note on #65)', () => {
  it('names the dog and the date, like the membership summaries', () => {
    expect(
      describeBookingRequest({
        bookingDogIds: ids(1),
        kind: 'standard',
        totalPence: 5000,
        dogNames: ['Biscuit'],
        dates: ['2026-11-04'],
      }),
    ).toBe('Biscuit: Day care on 4 November 2026 · 1 dog-day · £50.00');
  });

  it('lists each dog once and gives the date range for several days', () => {
    expect(
      describeBookingRequest({
        bookingDogIds: ids(4),
        kind: 'standard',
        totalPence: 20000,
        dogNames: ['Biscuit', 'Rex', 'Biscuit', 'Rex'],
        dates: ['2026-11-06', '2026-11-04', '2026-11-06', '2026-11-04'],
      }),
    ).toBe('Biscuit and Rex: Day care on 2 days, 4 November 2026 to 6 November 2026 · 4 dog-days · £200.00');
    expect(
      describeBookingRequest({
        bookingDogIds: ids(3),
        kind: 'standard',
        totalPence: 0,
        dogNames: ['Ash', 'Bo', 'Cy'],
        dates: ['2026-11-04'],
      }),
    ).toMatch(/^Ash, Bo and Cy: Day care on 4 November 2026 · 3 dog-days/);
  });

  it('says trial day for a trial', () => {
    expect(
      describeBookingRequest({
        bookingDogIds: ids(1),
        kind: 'trial',
        totalPence: 2500,
        dogNames: ['Moss'],
        dates: ['2026-12-01'],
      }),
    ).toBe('Moss: Trial day on 1 December 2026 · 1 dog-day · £25.00');
  });

  it('keeps the short form for requests saved before names and dates were stored', () => {
    expect(describeBookingRequest({ bookingDogIds: ids(1), kind: 'standard', totalPence: 5000 })).toBe(
      'Day care · 1 dog-day · £50.00',
    );
  });

  it.each(['rejected', 'withdrawn'] as const)('the %s email carries the dog and date', (outcome) => {
    const summary = describeBookingRequest({
      bookingDogIds: ids(1),
      kind: 'standard',
      totalPence: 5000,
      dogNames: ['Biscuit'],
      dates: ['2026-11-04'],
    });
    const m = approvalDecisionMessage(
      'c@example.test',
      'Casey',
      { label: 'Booking request', summary, outcome },
      'https://x.test/account/bookings',
    );
    expect(m.text).toContain('Biscuit: Day care on 4 November 2026');
    expect(m.html).toContain('Biscuit: Day care on 4 November 2026');
  });
});

describe('apostrophes in customer emails are curly', () => {
  const straight = /[A-Za-z]'[a-z]/;

  it('the approved-booking (pay to secure) email', () => {
    const m = paymentLinkMessage(
      'c@example.test',
      'Casey',
      { amountText: '£50.00', forText: 'Biscuit on 4 November 2026', untilText: '18:00 on 3 November', approved: true },
      'https://x.test/pay',
    );
    for (const part of [m.subject, m.text, m.html]) expect(part).not.toMatch(straight);
    expect(m.text).toContain('We’re holding');
    expect(m.text).toContain('isn’t paid');
  });

  it.each(['src/infra/email/templates.ts', 'src/server/services/memberships.ts'])(
    'no straight apostrophe in the email text of %s',
    (file) => {
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // comments may use either
        .map((l) => l.replace(/\s\/\/ .*$/, ''));
      const offenders = code.filter((l) => straight.test(l) && /[`"]/.test(l));
      expect(offenders).toEqual([]);
    },
  );
});
