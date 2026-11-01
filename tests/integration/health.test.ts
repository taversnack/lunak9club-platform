import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb, type Db } from '@/infra/db/client';
import { runHealthChecks } from '@/infra/db/health';

afterAll(closeDb);
afterEach(() => {
  vi.doUnmock('@/infra/db/client');
  vi.resetModules();
});

class Rollback extends Error {}

/** Run `fn` inside a transaction that is always rolled back, so the shared test database is untouched. */
async function inRolledBackTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await getDb().transaction(async (tx) => {
      out = await fn(tx as unknown as Db);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out as T;
}

describe('/api/health', () => {
  it('is ok when the database answers and every migration is applied', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: { database: string; migrations: string } };
    expect(body.status).toBe('ok');
    expect(body.checks.database).toBe('ok');
    expect(body.checks.migrations).toBe('ok');
  });

  it('answers 503 "degraded" when the database is unreachable, without leaking the error', async () => {
    const down = {
      execute: () => Promise.reject(new Error('connect ECONNREFUSED postgres://user:secret@db.internal:5432/x')),
    };
    vi.doMock('@/infra/db/client', () => ({ getDb: () => down }));
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ status: 'degraded', checks: { database: 'down' } });
    expect(text).not.toMatch(/secret|ECONNREFUSED|postgres:/);
  });

  it('answers 503 when the app cannot even get a database handle (bad configuration)', async () => {
    vi.doMock('@/infra/db/client', () => ({
      getDb: () => {
        throw new Error('Invalid environment configuration: DATABASE_URL');
      },
    }));
    const { GET } = await import('@/app/api/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'degraded' });
    expect(text).not.toMatch(/DATABASE_URL/);
  });

  it('reports pending migrations when one is missing from the migrations table', async () => {
    const checks = await inRolledBackTx(async (tx) => {
      await tx.execute(
        sql`delete from drizzle.__drizzle_migrations where id = (select max(id) from drizzle.__drizzle_migrations)`,
      );
      return runHealthChecks(tx);
    });
    expect(checks).toEqual({ database: 'ok', migrations: 'pending' });
    // The rollback restored the table.
    expect(await runHealthChecks(getDb())).toEqual({ database: 'ok', migrations: 'ok' });
  });
});
