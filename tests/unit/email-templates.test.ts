import { describe, expect, it } from 'vitest';
import { cardRefundMessage, resetPasswordMessage, verifyEmailMessage } from '@/infra/email/templates';

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
});
