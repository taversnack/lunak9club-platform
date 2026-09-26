import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __lunak9Pool?: Pool; __lunak9Db?: Db };

export function createDb(connectionString: string): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString, max: 10 });
  return { db: drizzle(pool, { schema, casing: 'snake_case' }), pool };
}

/** Process-wide database handle (reused across hot reloads in development). */
export function getDb(): Db {
  if (!globalForDb.__lunak9Db) {
    const { db, pool } = createDb(env().DATABASE_URL);
    globalForDb.__lunak9Pool = pool;
    globalForDb.__lunak9Db = db;
  }
  return globalForDb.__lunak9Db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__lunak9Pool?.end();
  globalForDb.__lunak9Pool = undefined;
  globalForDb.__lunak9Db = undefined;
}
