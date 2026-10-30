import { afterEach, describe, expect, it, vi } from 'vitest';

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('rejects a short auth secret', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x@localhost/db');
    vi.stubEnv('BETTER_AUTH_SECRET', 'short');
    const { env } = await import('@/infra/env');
    expect(() => env()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('refuses non-SMTP email in production', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x@localhost/db');
    vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(40));
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('EMAIL_TRANSPORT', 'file');
    const { env } = await import('@/infra/env');
    expect(() => env()).toThrow(/real email transport/);
  });

  const base = () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x@localhost/db');
    vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(40));
  };
  const productionReady = () => {
    base();
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://app.lunak9club.example');
    vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
    vi.stubEnv('EMAIL_SANDBOX', '0');
    vi.stubEnv('SMTP_HOST', 'smtp.mail-provider.example');
    vi.stubEnv('SMTP_PORT', '587');
    vi.stubEnv('SMTP_TLS', 'starttls');
    vi.stubEnv('SMTP_USER', 'mailer');
    vi.stubEnv('SMTP_PASSWORD', 'p'.repeat(20));
    vi.stubEnv('PAYMENTS_DRIVER', 'stripe');
    // Built from parts so secret scanners don't mistake these fakes for real keys.
    vi.stubEnv('STRIPE_SECRET_KEY', ['sk', 'live', 'abc123'].join('_'));
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', ['whsec', 'abc123'].join('_'));
    vi.stubEnv('STORAGE_DRIVER', 's3');
    vi.stubEnv('S3_ENDPOINT', 'https://r2.example');
    vi.stubEnv('S3_BUCKET', 'docs');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'id');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'secret');
    vi.stubEnv('CRON_SECRET', 'c'.repeat(40));
    vi.stubEnv('TRUSTED_PROXIES', '10.0.0.0/8');
  };

  it('wants to know how to find the client address in production while the auth rate limit is on', async () => {
    productionReady();
    vi.stubEnv('TRUSTED_PROXIES', '');
    let { env } = await import('@/infra/env');
    expect(() => env()).toThrow(/TRUSTED_PROXIES or CLIENT_IP_HEADER is required/);
    vi.resetModules();
    vi.stubEnv('CLIENT_IP_HEADER', 'CF-Connecting-IP');
    ({ env } = await import('@/infra/env'));
    expect(env().CLIENT_IP_HEADER).toBe('cf-connecting-ip');
    // Blank lines copied from .env.example mean "not set".
    vi.resetModules();
    vi.stubEnv('CLIENT_IP_HEADER', '');
    vi.stubEnv('TRUSTED_PROXIES', '');
    ({ env } = await import('@/infra/env'));
    expect(() => env()).toThrow(/TRUSTED_PROXIES or CLIENT_IP_HEADER is required/);
    vi.resetModules();
    vi.stubEnv('CLIENT_IP_HEADER', 'x-real-ip, x-forwarded-for');
    ({ env } = await import('@/infra/env'));
    expect(() => env()).toThrow(/CLIENT_IP_HEADER/);
  });

  it('parses TRUSTED_PROXIES and refuses entries that are not addresses or CIDR ranges', async () => {
    base();
    vi.stubEnv('TRUSTED_PROXIES', ' 10.0.0.0/8, 192.0.2.1 ,2001:db8::/32');
    let { env } = await import('@/infra/env');
    expect(env().TRUSTED_PROXIES).toEqual(['10.0.0.0/8', '192.0.2.1', '2001:db8::/32']);
    for (const bad of ['10.0.0.0/33', 'proxy.internal', '10.0.0.1/8/1', '*']) {
      vi.resetModules();
      vi.stubEnv('TRUSTED_PROXIES', bad);
      ({ env } = await import('@/infra/env'));
      expect(() => env(), bad).toThrow(/TRUSTED_PROXIES/);
    }
  });

  it('trusts no forwarded header unless one is configured', async () => {
    const { clientIpOptions } = await import('@/infra/auth/auth');
    expect(clientIpOptions({ TRUSTED_PROXIES: [], CLIENT_IP_HEADER: undefined })).toEqual({ ipAddressHeaders: [] });
    expect(clientIpOptions({ TRUSTED_PROXIES: ['10.0.0.0/8'], CLIENT_IP_HEADER: undefined })).toEqual({
      ipAddressHeaders: ['x-forwarded-for'],
      trustedProxies: ['10.0.0.0/8'],
    });
    expect(clientIpOptions({ TRUSTED_PROXIES: [], CLIENT_IP_HEADER: 'fly-client-ip' })).toEqual({
      ipAddressHeaders: ['fly-client-ip'],
    });
  });

  it('refuses to run a production build without APP_ENV (M3)', async () => {
    base();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', '');
    const { env } = await import('@/infra/env');
    expect(() => env()).toThrow(/APP_ENV must be set/);
  });

  it('lets a production build run as test (e2e) or development when APP_ENV says so', async () => {
    base();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', 'test');
    const { env } = await import('@/infra/env');
    expect(env().APP_ENV).toBe('test');
  });

  it('lists every unsafe default left in a production configuration (M3)', async () => {
    base();
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('EMAIL_TRANSPORT', 'smtp');
    const { env } = await import('@/infra/env');
    expect(() => env()).toThrow(
      /EMAIL_SANDBOX.*APP_URL.*PAYMENTS_DRIVER must be stripe.*STORAGE_DRIVER must be s3.*CRON_SECRET/,
    );
  });

  it('wants the Stripe and S3 secrets that go with the production drivers', async () => {
    productionReady();
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    vi.stubEnv('S3_BUCKET', '');
    const { env } = await import('@/infra/env');
    expect(() => env()).toThrow(/STRIPE_WEBHOOK_SECRET.*S3_BUCKET/);
  });

  it('accepts a complete production configuration', async () => {
    productionReady();
    const { env } = await import('@/infra/env');
    expect(env().APP_ENV).toBe('production');
  });

  it('checks the configuration when a production server starts, but not during next build', async () => {
    base();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('APP_ENV', '');
    // A bad configuration stops the process (#32) rather than throwing into a server that stays up.
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { register } = await import('@/instrumentation');
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(logged.mock.calls[0]![0]).toMatch(/Refusing to start: APP_ENV must be set/);
    exit.mockClear();
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    await expect(register()).resolves.toBeUndefined();
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
    logged.mockRestore();
  });

  describe('SMTP settings', () => {
    it('keeps the local Mailpit defaults valid', async () => {
      base();
      const { env } = await import('@/infra/env');
      expect(env()).toMatchObject({ SMTP_HOST: 'localhost', SMTP_PORT: 1025, SMTP_TLS: 'off' });
      expect(env().SMTP_USER).toBeUndefined();
    });

    it('wants SMTP_USER and SMTP_PASSWORD together, in any environment, without echoing values', async () => {
      base();
      vi.stubEnv('SMTP_USER', 'mailer');
      const { env } = await import('@/infra/env');
      expect(() => env()).toThrow(/SMTP_USER and SMTP_PASSWORD must be set together/);
      vi.resetModules();
      vi.stubEnv('SMTP_USER', '');
      vi.stubEnv('SMTP_PASSWORD', 'topsecretvalue');
      const again = await import('@/infra/env');
      try {
        again.env();
        throw new Error('expected env() to throw');
      } catch (e) {
        expect((e as Error).message).not.toContain('topsecretvalue');
      }
    });

    it('rejects an unknown SMTP_TLS value', async () => {
      base();
      vi.stubEnv('SMTP_TLS', 'maybe');
      const { env } = await import('@/infra/env');
      expect(() => env()).toThrow(/SMTP_TLS/);
    });

    it.each([
      ['a local host', { SMTP_HOST: 'localhost' }, /SMTP_HOST must be/],
      ['no TLS', { SMTP_TLS: 'off' }, /SMTP_TLS must be starttls or tls/],
      ['no login', { SMTP_USER: '', SMTP_PASSWORD: '' }, /SMTP_USER and SMTP_PASSWORD are required/],
    ])('refuses production with %s', async (_name, change, message) => {
      productionReady();
      for (const [k, v] of Object.entries(change)) vi.stubEnv(k, v);
      const { env } = await import('@/infra/env');
      expect(() => env()).toThrow(message);
    });

    it('accepts a production SMTP provider with TLS and a login', async () => {
      productionReady();
      const { env } = await import('@/infra/env');
      expect(env()).toMatchObject({ SMTP_HOST: 'smtp.mail-provider.example', SMTP_TLS: 'starttls' });
    });
  });
});
