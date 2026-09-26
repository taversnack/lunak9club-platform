import { describe, expect, it } from 'vitest';
import { resetPasswordMessage, verifyEmailMessage } from '@/infra/email/templates';

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
});
