// Usage: OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" OWNER_PASSWORD='…' pnpm owner:create
// Creates (or promotes) the first Owner account. Password comes from the environment so it
// never appears in shell history as an argument. If omitted, a strong one is generated and shown once.
import { assertSafeDatabaseUrl } from './_env';
import { randomBytes } from 'node:crypto';
import { createDb } from '../src/infra/db/client';
import { ensureUser } from './lib/users';

const email = process.env.OWNER_EMAIL;
const name = process.env.OWNER_NAME ?? 'Owner';
if (!email) throw new Error('Set OWNER_EMAIL');
let password = process.env.OWNER_PASSWORD;
const generated = !password;
password ??= randomBytes(18).toString('base64url');
if (password.length < 10) throw new Error('OWNER_PASSWORD must be at least 10 characters');

const { db, pool } = createDb(assertSafeDatabaseUrl(process.env.DATABASE_URL));
const id = await ensureUser(db, { email, name, password, role: 'owner' });
await pool.end();
console.log(`Owner ready (user ${id}).`);
if (generated) console.log(`Generated password (shown once, change it after signing in): ${password}`);
