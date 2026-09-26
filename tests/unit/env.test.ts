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
});
