import { testDatabaseUrl } from './test-db-url';

process.env.DATABASE_URL = testDatabaseUrl();
process.env.APP_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.BETTER_AUTH_SECRET ??= 'test-secret-test-secret-test-secret-000';
process.env.EMAIL_TRANSPORT = 'console';
process.env.LOG_LEVEL = 'error';
// Requests in tests arrive as if through one proxy at 198.51.100.1 that appends the caller's address
// to X-Forwarded-For (tests/support/auth-http.ts), as production's does.
process.env.TRUSTED_PROXIES = '198.51.100.1';
delete process.env.CLIENT_IP_HEADER;

// Run the whole suite as if on another day: TEST_NOW=2026-12-20T09:00:00Z pnpm test:int. The clock then
// keeps running from there in 1 ms steps, like the real one (the 20 ms default gave back-to-back rows
// the same timestamp, so tests ordering by created_at flipped). Only Date is faked (timers stay real,
// so the database driver is unaffected). Used to prove no test depends on the real date.
// Postgres now() is NOT faked. When a test backdates a row for the app to compare (a lapsed hold, a stale
// refund), use the JS clock (`new Date(Date.now() - …)`), never `now() - interval …`: a pin in the past
// makes a DB-clock value look like the future to the app (it broke two payments tests at
// TEST_NOW=2026-10-14). Postgres now() is fine where nothing compares it with the app's clock.
if (process.env.TEST_NOW) {
  const { vi } = await import('vitest');
  vi.useFakeTimers({
    toFake: ['Date'],
    now: new Date(process.env.TEST_NOW),
    shouldAdvanceTime: true,
    advanceTimeDelta: 1,
  });
}

// Guard: queueing a second query on a busy connection (e.g. Promise.all over reads on a transaction)
// is deprecated in pg 8 and an error in pg 9. Any file that triggers it fails here (use inSequence).
{
  const { afterAll } = await import('vitest');
  const busy: string[] = [];
  process.on('warning', (w) => {
    if (/already executing a query/.test(w.message)) busy.push(w.message);
  });
  afterAll(async () => {
    await new Promise((r) => setImmediate(r));
    if (busy.length)
      throw new Error(
        'A query was queued on a connection that was already busy (Promise.all over reads on a transaction?). Use inSequence from src/infra/db/sequence.ts.',
      );
  });
}
