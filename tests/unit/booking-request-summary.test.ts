import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeBookingRequest } from '@/domain/booking/describe-request';
import { clampSummary, SUMMARY_MAX } from '@/domain/approvals/rules';
import { addDays } from '@/domain/time';
import { approvalDecisionMessage, membershipConfirmedMessage, paymentLinkMessage } from '@/infra/email/templates';

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

  it('lists each dog once, and lists days that are not consecutive', () => {
    expect(
      describeBookingRequest({
        bookingDogIds: ids(4),
        kind: 'standard',
        totalPence: 20000,
        dogNames: ['Biscuit', 'Rex', 'Biscuit', 'Rex'],
        dates: ['2026-11-06', '2026-11-04', '2026-11-06', '2026-11-04'],
      }),
    ).toBe('Biscuit and Rex: Day care on 4 and 6 November 2026 · 4 dog-days · £200.00');
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

  it('gives a range only for consecutive days', () => {
    const base = { bookingDogIds: ids(3), kind: 'standard' as const, totalPence: 15000, dogNames: ['Rex'] };
    expect(describeBookingRequest({ ...base, dates: ['2026-11-18', '2026-11-16', '2026-11-17'] })).toBe(
      'Rex: Day care on 3 days, 16 November 2026 to 18 November 2026 · 3 dog-days · £150.00',
    );
    expect(describeBookingRequest({ ...base, dates: ['2026-11-16', '2026-11-18', '2026-11-20'] })).toBe(
      'Rex: Day care on 16, 18 and 20 November 2026 · 3 dog-days · £150.00',
    );
    expect(describeBookingRequest({ ...base, dates: ['2026-11-30', '2026-12-02', '2027-01-04'] })).toBe(
      'Rex: Day care on 30 November, 2 December 2026 and 4 January 2027 · 3 dog-days · £150.00',
    );
    // Across a month end, consecutive is still a range.
    expect(describeBookingRequest({ ...base, dates: ['2026-11-30', '2026-12-01'] })).toContain(
      'on 2 days, 30 November 2026 to 1 December 2026',
    );
  });

  it('stays within the summary limit by shortening names and dates, never the dog-days and price', () => {
    const tail = /· 40 dog-days · £2,000\.00$/;
    const many = Array.from({ length: 40 }, (_, i) => addDays('2026-11-02', i * 2));
    const longNames = [
      'Sir Reginald Fluffington-Barkworth the Third',
      'Lady Penelope Wagglesworth of Upper Snoring',
      'Duke',
    ];
    const out = describeBookingRequest({
      bookingDogIds: ids(40),
      kind: 'standard',
      totalPence: 200000,
      dogNames: longNames,
      dates: many,
    });
    expect(out.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(clampSummary(out)).toBe(out);
    expect(out).toMatch(tail);
    expect(out).toContain('on 40 days between 2 November 2026 and 19 January 2027');

    const crowd = Array.from({ length: 12 }, (_, i) => `Dog with a rather long name number ${i + 1}`);
    const out2 = describeBookingRequest({
      bookingDogIds: ids(40),
      kind: 'standard',
      totalPence: 200000,
      dogNames: crowd,
      dates: ['2026-11-04'],
    });
    expect(out2.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(out2).toMatch(
      /^Dog with a rather long name number 1, .* and \d+ more: Day care on 4 November 2026 · 40 dog-days · £2,000\.00$/,
    );

    const huge = 'B'.repeat(400);
    const out3 = describeBookingRequest({
      bookingDogIds: ids(40),
      kind: 'standard',
      totalPence: 200000,
      dogNames: [huge, 'Rex'],
      dates: ['2026-11-04'],
    });
    expect(out3.length).toBeLessThanOrEqual(SUMMARY_MAX);
    expect(out3).toMatch(/^B+… and 1 more: Day care on 4 November 2026 · 40 dog-days · £2,000\.00$/);
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
      // Works with the field named `label` (main) or `noun` (#65): spread props aren't excess-checked.
      { ...{ label: 'Booking request', noun: 'booking request' }, summary, outcome },
      'https://x.test/account/bookings',
    );
    expect(m.text).toContain('Biscuit: Day care on 4 November 2026');
    expect(m.html).toContain('Biscuit: Day care on 4 November 2026');
  });
});

describe('membership confirmed email', () => {
  it('escapes the dog’s and the customer’s names in the HTML', () => {
    const m = membershipConfirmedMessage('c@example.test', '<b>Casey</b> "C"', {
      dogName: `<script>alert('x')</script> & "Rex"`,
      pattern: 'Mon, Wed – full day',
      startsOn: '2 November 2026',
      url: 'https://x.test/account/bookings?a=1&b=2',
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>');
    expect(m.html).toContain('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;Rex&quot;’s membership');
    expect(m.html).toContain('Hi &lt;b&gt;Casey&lt;/b&gt; &quot;C&quot;,');
    expect(m.subject).toBe(`Luna’s K9 Club: <script>alert('x')</script> & "Rex"’s membership is confirmed`);
    expect(m.text).toContain('(Mon, Wed – full day) starts on 2 November 2026');
  });
});

describe('apostrophes in customer emails are curly', () => {
  // A letter, or the end of an interpolation (`${dogName}'s`), then a straight apostrophe.
  const straight = /[A-Za-z})]'[a-z]/;

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

  // Every source file that builds or sends an email, so new ones are checked too.
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
  const emailFiles = walk('src').filter((f) =>
    /sendSafely|sendEmail|infra\/email\/templates|EmailMessage/.test(readFileSync(f, 'utf8')),
  );

  it('finds the email-producing files', () => {
    for (const f of [
      'src/infra/email/templates.ts',
      'src/infra/auth/auth.ts',
      'src/server/services/memberships.ts',
      'src/server/services/jobs.ts',
      'src/server/notify.ts',
      'src/server/services/membership-workflow.ts',
      'src/server/services/booking-requests.ts',
    ])
      expect(emailFiles).toContain(f);
  });

  it.each(emailFiles)('no straight apostrophe in the email text of %s', (file) => {
    const code = readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // comments may use either
      .map((l) => l.replace(/\s\/\/ .*$/, ''));
    const offenders = code.filter((l) => straight.test(l) && /[`"]/.test(l));
    expect(offenders).toEqual([]);
  });
});
