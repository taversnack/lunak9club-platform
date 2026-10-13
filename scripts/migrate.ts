import { assertSafeDatabaseUrl } from './_env';
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/infra/db/client';
import { migrationStateProblem, type JournalEntry } from '../src/infra/db/migration-guard';

const url = assertSafeDatabaseUrl(process.env.DATABASE_URL);
const { db, pool } = createDb(url);
const journal = (JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8')) as { entries: JournalEntry[] })
  .entries;
const exists = await db.execute<{ t: string | null }>(
  sql`select to_regclass('drizzle.__drizzle_migrations')::text as t`,
);
const applied = exists.rows[0]?.t
  ? (await db.execute<{ c: string }>(sql`select created_at::text as c from drizzle.__drizzle_migrations`)).rows.map(
      (r) => Number(r.c),
    )
  : [];
const problem = migrationStateProblem(journal, applied);
if (problem) {
  await pool.end();
  console.error(problem);
  process.exit(1);
}
await migrate(db, { migrationsFolder: './drizzle' });
await pool.end();
console.log('Migrations applied.');
