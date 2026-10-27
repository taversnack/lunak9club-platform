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
