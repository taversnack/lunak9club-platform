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

  it('lets a document be held for a virus scan (D30) and refuses unknown scan states or negative attempts', async () => {
    const defs = await getDb().execute<{ conname: string; def: string }>(
      sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'documents'::regclass and conname in ('documents_scan_chk', 'documents_scan_attempts_chk')`,
    );
    const by = Object.fromEntries(defs.rows.map((r) => [r.conname, r.def]));
    expect(by.documents_scan_chk).toMatch(/not_scanned.*held.*clean.*infected/s);
    expect(by.documents_scan_attempts_chk).toMatch(/scan_attempts >= 0/);
    const cols = await getDb().execute<{ column_name: string; column_default: string | null; is_nullable: string }>(
      sql`select column_name, column_default, is_nullable from information_schema.columns where table_name = 'documents' and column_name in ('scan_attempts', 'scanned_at')`,
    );
    const c = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    expect(c.scan_attempts).toMatchObject({ column_default: '0', is_nullable: 'NO' });
    expect(c.scanned_at).toMatchObject({ is_nullable: 'YES' });
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
