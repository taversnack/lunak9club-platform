import { describe, expect, it } from 'vitest';
import { SmtpEmailProvider, smtpTransportOptions } from '@/infra/email/providers';

const base = { host: 'smtp.mail-provider.example', port: 587 };

describe('smtpTransportOptions', () => {
  it('is plain with no login for Mailpit', () => {
    expect(smtpTransportOptions({ host: 'localhost', port: 1025, tls: 'off' })).toEqual({
      host: 'localhost',
      port: 1025,
      secure: false,
      requireTLS: false,
    });
  });
  it('requires STARTTLS on the submission port', () => {
    expect(smtpTransportOptions({ ...base, tls: 'starttls', user: 'u', password: 'p' })).toEqual({
      ...base,
      secure: false,
      requireTLS: true,
      auth: { user: 'u', pass: 'p' },
    });
  });
  it('uses implicit TLS on port 465', () => {
    expect(smtpTransportOptions({ host: base.host, port: 465, tls: 'tls', user: 'u', password: 'p' })).toMatchObject({
      secure: true,
      requireTLS: false,
    });
  });
  it('sends no login unless both parts are set', () => {
    expect(smtpTransportOptions({ ...base, tls: 'tls', user: 'u' })).not.toHaveProperty('auth');
  });
});

describe('SmtpEmailProvider', () => {
  it('in sandbox mode refuses a non-local host without leaking settings', () => {
    try {
      new SmtpEmailProvider({ ...base, tls: 'starttls', user: 'u', password: 'secret-pass' }, 'a@b.test', true);
      throw new Error('expected the constructor to throw');
    } catch (e) {
      expect((e as Error).message).toMatch(/EMAIL_SANDBOX=1 only allows a local SMTP host/);
      expect((e as Error).message).not.toContain('secret-pass');
      expect((e as Error).message).not.toContain(base.host);
    }
  });
  it('builds for a real host outside sandbox mode without connecting', () => {
    expect(
      () => new SmtpEmailProvider({ ...base, tls: 'starttls', user: 'u', password: 'p' }, 'a@b.test', false),
    ).not.toThrow();
  });
});
