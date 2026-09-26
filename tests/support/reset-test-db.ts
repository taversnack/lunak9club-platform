import { Client } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../../src/infra/db/client';
import { testDatabaseUrl } from './test-db-url';

/** Drop everything in the test database and apply all migrations from zero. */
export async function resetAndMigrateTestDb(): Promise<string> {
  const url = testDatabaseUrl();
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await c.end();
  const { db, pool } = createDb(url);
  await migrate(db, { migrationsFolder: './drizzle' });
  await pool.end();
  return url;
}
