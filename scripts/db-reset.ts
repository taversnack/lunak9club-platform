import { assertSafeDatabaseUrl } from './_env';
import { Client } from 'pg';

// Drops and recreates the public schema. Local/test databases only (guarded).
const url = assertSafeDatabaseUrl(process.env.DATABASE_URL);
const client = new Client({ connectionString: url });
await client.connect();
await client.query(
  'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
);
await client.end();
console.log(`Reset ${new URL(url).pathname.slice(1)}.`);
