import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertNotProduction, assertSafeDatabaseUrl } from '../../scripts/_env';

afterEach(() => vi.unstubAllEnvs());

describe('assertNotProduction (seed and db:reset never run in production)', () => {
  it('refuses when APP_ENV or NODE_ENV says production, even with the remote-database override', () => {
    vi.stubEnv('ALLOW_REMOTE_DB', 'yes-i-have-owner-approval');
    vi.stubEnv('APP_ENV', 'production');
    expect(() => assertNotProduction('seed demo data')).toThrow(
      /Refusing to seed demo data in a production environment/,
    );
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertNotProduction('reset the database')).toThrow(/production/);
  });
  it('allows development and test', () => {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => assertNotProduction('seed demo data')).not.toThrow();
  });
});

describe('assertSafeDatabaseUrl', () => {
  it('still refuses a remote host unless the database is named test or the Owner override is set', () => {
    vi.stubEnv('ALLOW_REMOTE_DB', '');
    expect(() => assertSafeDatabaseUrl('postgres://u:p@db.example.com/lunak9')).toThrow(/non-local/);
    expect(assertSafeDatabaseUrl('postgres://u:p@db.example.com/lunak9_test')).toContain('lunak9_test');
  });
});
