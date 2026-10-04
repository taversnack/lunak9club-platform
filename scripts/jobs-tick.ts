// Usage: pnpm jobs:tick   (runs one scheduler tick against the local database)
// Optional: JOBS_NOW=2026-10-28T09:05:00Z pnpm jobs:tick   to rehearse a date locally.
import { assertSafeDatabaseUrl } from './_env';
import { createDb } from '../src/infra/db/client';
import { runTick } from '../src/server/services/jobs';

const { db, pool } = createDb(assertSafeDatabaseUrl(process.env.DATABASE_URL));
const now = process.env.JOBS_NOW ? new Date(process.env.JOBS_NOW) : new Date();
if (Number.isNaN(now.getTime())) throw new Error('JOBS_NOW is not a valid date');
const result = await runTick(db, { kind: 'system', job: 'scheduler' }, now);
await pool.end();
console.log(JSON.stringify(result, null, 2));
