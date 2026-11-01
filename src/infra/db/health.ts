import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Db } from './client';
import type { JournalEntry } from './migration-guard';

export type HealthChecks = { database: 'ok' | 'down'; migrations: 'ok' | 'pending' | 'unknown' };

/** Journal entries not yet recorded as applied (by their `when` timestamp). */
export function pendingMigrations(journal: JournalEntry[], appliedCreatedAt: number[]): JournalEntry[] {
  const applied = new Set(appliedCreatedAt);
  return journal.filter((e) => !applied.has(e.when));
}

async function readJournal(): Promise<JournalEntry[] | null> {
  try {
    const raw = await readFile(join(process.cwd(), 'drizzle', 'meta', '_journal.json'), 'utf8');
    return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
  } catch {
    return null; // journal not shipped with this build: can't compare
  }
}

/** Readiness probe. Returns names of checks only, never connection details or errors. */
export async function runHealthChecks(db: Db): Promise<HealthChecks> {
  try {
    await db.execute(sql`select 1`);
  } catch {
    return { database: 'down', migrations: 'unknown' };
  }
  try {
    const journal = await readJournal();
    if (!journal) return { database: 'ok', migrations: 'unknown' };
    const rows = await db.execute<{ c: string }>(sql`select created_at::text as c from drizzle.__drizzle_migrations`);
    const pending = pendingMigrations(
      journal,
      rows.rows.map((r) => Number(r.c)),
    );
    return { database: 'ok', migrations: pending.length ? 'pending' : 'ok' };
  } catch {
    return { database: 'ok', migrations: 'pending' }; // migrations table missing: never migrated
  }
}
