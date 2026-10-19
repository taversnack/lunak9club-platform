import { testDatabaseUrl } from './test-db-url';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.APP_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-000';
process.env.EMAIL_TRANSPORT = 'console';
process.env.LOG_LEVEL = 'error';

// Run the whole suite as if on another day: TEST_NOW=2026-12-20T09:00:00Z pnpm test:int. The clock then
// keeps running from there in 1 ms steps, like the real one (the 20 ms default gave back-to-back rows
// the same timestamp, so tests ordering by created_at flipped). Only Date is faked (timers stay real,
// so the database driver is unaffected). Used to prove no test depends on the real date.
if (process.env.TEST_NOW) {
  const { vi } = await import('vitest');
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date(process.env.TEST_NOW),
    shouldAdvanceTime: true,
    advanceTimeDelta: 1,
  });
}
