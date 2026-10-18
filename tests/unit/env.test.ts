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
  };

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
});
