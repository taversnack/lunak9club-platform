import { assertSafeDatabaseUrl } from './_env';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from '../src/infra/db/client';

const url = assertSafeDatabaseUrl(process.env.DATABASE_URL);
const { db, pool } = createDb(url);
await migrate(db, { migrationsFolder: './drizzle' });
await pool.end();
console.log('Migrations applied.');
