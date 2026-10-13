import { afterEach, describe, expect, it, vi } from 'vitest';

/** The production config guard (M3) must stop the server, not leave it up serving 500s. */
describe('server start-up config guard', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const startAsProductionServer = () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PHASE', 'phase-production-server');
    vi.stubEnv('DATABASE_URL', 'postgres://x@localhost/db');
    vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(40));
  };

  it('exits with code 1 and says why when the configuration is unsafe', async () => {
    startAsProductionServer();
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('EMAIL_SANDBOX', '1');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { register } = await import('@/instrumentation');
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(err.mock.calls[0]![0]).toMatch(/Refusing to start: Unsafe production configuration/);
  });

  it('does not exit during next build', async () => {
    startAsProductionServer();
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('EMAIL_SANDBOX', '1');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { register } = await import('@/instrumentation');
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});
