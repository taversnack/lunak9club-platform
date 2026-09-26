import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { recordAudit } from '@/server/audit';

afterAll(closeDb);

/** Drizzle wraps driver errors; assert on the underlying Postgres message/constraint. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const cause = (e as { cause?: { message?: string; constraint?: string } }).cause;
    return `${cause?.constraint ?? ''} ${cause?.message ?? String(e)}`;
  }
  throw new Error('expected the query to fail');
}

describe('database invariants', () => {
  it('seeds the launch roles', async () => {
    const r = await getDb().execute<{ key: string }>(sql`select key from roles order by key`);
    expect(r.rows.map((x) => x.key)).toEqual(['customer', 'owner']);
  });

  it('keeps audit_events append-only', async () => {
    const db = getDb();
    await recordAudit(db, { actor: { kind: 'system', job: 'test' }, action: 'test.event', entityType: 'test' });
    expect(await pgError(db.execute(sql`update audit_events set action = 'tampered'`))).toMatch(/append-only \(UPDATE/);
    expect(await pgError(db.execute(sql`delete from audit_events`))).toMatch(/append-only \(DELETE/);
    expect(await pgError(db.execute(sql`truncate audit_events`))).toMatch(/append-only \(TRUNCATE/);
  });

  it('allows audit maintenance only inside an explicit maintenance transaction', async () => {
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local lunak9.audit_maintenance = 'on'`);
      await tx.execute(sql`update audit_events set metadata = '{}'::jsonb where action = 'test.event'`);
    });
    expect(await pgError(db.execute(sql`update audit_events set metadata = '{}'::jsonb`))).toMatch(/append-only/);
  });

  it('rejects invalid actor types', async () => {
    const msg = await pgError(
      getDb().execute(sql`insert into audit_events (actor_type, action, entity_type) values ('robot', 'x', 'y')`),
    );
    expect(msg).toMatch(/audit_events_actor_type_chk/);
  });
});
