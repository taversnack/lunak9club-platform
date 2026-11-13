import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cardRefundMessage,
  ownerConfirmationSummaryMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from '@/infra/email/templates';

describe('email templates', () => {
  it('escapes names in HTML', () => {
    const m = verifyEmailMessage('a@example.test', '<script>x</script>', 'https://app.test/v?token=1');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('includes the action link and states expiry', () => {
    const m = resetPasswordMessage('a@example.test', 'Casey', 'https://app.test/r?token=abc');
    expect(m.text).toContain('https://app.test/r?token=abc');
    expect(m.text).toMatch(/expires in 1 hour/);
    expect(m.template).toBe('auth.reset-password');
  });

  it('card refund email: amount, what it was for and a link, in the usual layout', () => {
    const m = cardRefundMessage(
      'a@example.test',
      'Casey',
      { amountText: '£50.00', forText: 'invoice INV-1' },
      'https://app.test/account/invoices',
    );
    expect(m).toMatchObject({ to: 'a@example.test', template: 'payment.refund' });
    expect(m.subject).toBe('Luna’s K9 Club: refund of £50.00');
    expect(m.text).toContain('£50.00');
    expect(m.text).toContain('invoice INV-1');
    expect(m.html).toContain('https://app.test/account/invoices');
    // D58: refund timing varies by bank, so no promise of a number of days.
    for (const body of [m.text, m.html]) {
      expect(body).toContain('How long it takes to appear depends on your bank.');
      expect(body).not.toMatch(/working days|5–10/);
    }
  });

  it('Owner confirmation summary (D92–D94): names and dogs by status, club name once in the subject, nothing else', () => {
    const m = ownerConfirmationSummaryMessage(
      'owner@example.test',
      {
        monthText: 'November 2026',
        byText: '1 Nov 2026',
        unconfirmed: [{ name: 'Cara <Cole>', dogs: ['Nala', 'Ziggy'] }],
        late: [{ name: 'Bert Brown', dogs: ['Tess'], byOwner: true }],
        confirmed: [{ name: 'Alma Ash', dogs: ['Rolo'] }],
      },
      'https://app.test/admin',
    );
    expect(m.subject).toBe('Luna’s K9 Club: membership confirmations for November 2026 – 1 not confirmed');
    expect(m.subject.match(/Luna’s K9 Club/g)).toHaveLength(1);
    expect(m.template).toBe('owner.membership-confirmations');
    const i = (t: string) => m.text.indexOf(t);
    expect(i('Not confirmed (1)')).toBeLessThan(i('- Cara <Cole>: Nala, Ziggy'));
    expect(i('- Cara <Cole>: Nala, Ziggy')).toBeLessThan(i('Confirmed late, after 1 Nov 2026 (1)'));
    expect(i('Confirmed late')).toBeLessThan(i('- Bert Brown: Tess (confirmed by you)'));
    expect(i('- Bert Brown: Tess')).toBeLessThan(i('Confirmed (1)'));
    expect(i('Confirmed (1)')).toBeLessThan(i('- Alma Ash: Rolo'));
    expect(m.text).toMatch(/joined during November 2026 aren’t included/);
    expect(m.html).toContain('Cara &lt;Cole&gt;');
    expect(m.text).not.toMatch(/@|phone|address|vaccin|medical|£/i);
  });

  it('Owner confirmation summary says when everyone has confirmed and leaves out empty sections', () => {
    const m = ownerConfirmationSummaryMessage(
      'owner@example.test',
      {
        monthText: 'November 2026',
        byText: '1 Nov 2026',
        unconfirmed: [],
        late: [],
        confirmed: [{ name: 'A', dogs: ['B'] }],
      },
      'https://app.test/admin',
    );
    expect(m.subject).toMatch(/– all confirmed$/);
    expect(m.text).not.toContain('Not confirmed');
    expect(m.text).not.toContain('Confirmed late');
  });
});

describe('payment-link email wording (D76, D80)', () => {
  const args = { amountText: '£50.00', forText: 'day care for Biscuit (1 session)', untilText: '3 Nov 2026, 08:00' };
  it('says pay to SECURE the booking, never "confirm", with the deadline and the link', async () => {
    const { paymentLinkMessage } = await import('@/infra/email/templates');
    const m = paymentLinkMessage('a@example.test', 'Alice', args, 'https://app.test/pay/abc');
    expect(m.template).toBe('payment.link');
    for (const part of [m.subject, m.text, m.html]) {
      expect(part.toLowerCase()).toContain('secure your booking');
      expect(part.toLowerCase()).not.toMatch(/pay[^.]*to confirm/);
    }
    for (const part of [m.text, m.html]) {
      expect(part).toContain('3 Nov 2026, 08:00');
      expect(part).toContain('https://app.test/pay/abc');
    }
  });
});

describe('customer emails do not over-promise (D76, D79, D80, D81, D106)', () => {
  // A cheap guard over the source: phrases the Owner's decisions rule out must not come back.
  const files = [
    'src/infra/email/templates.ts',
    'src/server/services/bookings.ts',
    'src/server/services/booking-requests.ts',
  ];
  const banned: [RegExp, string][] = [
    [/pay[^'`.]*to confirm (it|your booking)/i, 'D80: it is "pay to secure the booking"'],
    [
      /we[’']ll be in touch if a place comes up/i,
      'D81: nothing about the waitlist is automatic; a place is not guaranteed',
    ],
    [/your booking is (now )?confirmed(?! once)/i, 'D76: a request is not a confirmed booking until approved and paid'],
    [/sorry we couldn[’']t answer/i, 'D79/D117: a closed request is neutral, not an apology'],
  ];
  it.each(files)('%s keeps clear of them', (file) => {
    const text = readFileSync(file, 'utf8');
    for (const [re, why] of banned) expect(text, why).not.toMatch(re);
  });
});

describe('the closed-request email (D79, D117)', () => {
  it('is neutral: not approved before the 23:59 cut-off, closed at no charge, no apology, no promise of availability', async () => {
    const { approvalDecisionMessage } = await import('@/infra/email/templates');
    const m = approvalDecisionMessage(
      'a@example.test',
      'Alice',
      { noun: 'booking request', summary: 'Biscuit – Tue 3 Nov, full day', outcome: 'expired' },
      'https://app.test/account/requests',
    );
    const body =
      'This request wasn’t approved before booking closed at 23:59 the day before, so it has closed at no charge. You can send a new request for another day.';
    expect(m.template).toBe('approval.expired');
    expect(m.text).toContain(body);
    expect(m.html).toContain(body.replace('’', '’')); // html-escaped apostrophes are left as typographic characters
    for (const part of [m.text, m.html]) {
      expect(part.toLowerCase()).not.toMatch(/sorry|couldn.t answer|nothing has been charged|available|space/);
    }
  });
  it('other kinds of request that expire get the same neutral tone without the cut-off sentence', async () => {
    const { approvalDecisionMessage } = await import('@/infra/email/templates');
    const m = approvalDecisionMessage(
      'a@example.test',
      'Alice',
      { noun: 'membership days request', summary: 'Biscuit', outcome: 'expired' },
      'https://app.test/account/requests',
    );
    expect(m.text).toContain('This request wasn’t answered in time, so it has closed at no charge.');
    expect(m.text).not.toContain('23:59');
  });
});
