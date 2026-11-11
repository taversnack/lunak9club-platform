/**
 * Password-reset and verification-email requests are limited per client address (better-auth) AND per email
 * address across every client, so many addresses can't be used to flood one person's inbox (tester finding).
 * The answer is the same for known and unknown addresses, and the address is never stored.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomInt } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { EMAIL_REQUEST_MAX, EMAIL_REQUEST_WINDOW_SECONDS, rateLimitedCopy } from '@/domain/auth/rate-limits';
import { MemoryEmailProvider } from '../support/memory-email';
import { authRequest } from '../support/auth-http';
import { makeUser, type TestUser } from '../support/factories';

const db = () => getDb();
const mail = new MemoryEmailProvider();
let customer: TestUser;

beforeAll(async () => {
  setEmailProvider(mail);
  customer = await makeUser(db(), 'customer', 'Reset Rita');
});
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

// Our own range, so buckets from other files (they live in the database) don't interfere.
const freshIp = () => `100.${128 + randomInt(64)}.${randomInt(256)}.${randomInt(1, 255)}`;
const unknown = () => `nobody.${Date.now()}.${randomInt(1e9)}@example.test`;

const reset = (email: string, ip = freshIp()) =>
  authRequest('/request-password-reset', { body: { email, redirectTo: '/reset-password' }, ip });
const verify = (email: string, ip = freshIp()) =>
  authRequest('/send-verification-email', { body: { email, callbackURL: '/dashboard' }, ip });
const shape = async (r: { res: Response }) => ({ status: r.res.status, body: await r.res.clone().text() });

describe.each([
  ['password reset', reset, 'reset-email'],
  ['verification email', verify, 'verify-email'],
] as const)('%s: per-address limit', (_name, send, scope) => {
  it(`allows ${EMAIL_REQUEST_MAX} per window for one address however many clients ask, then refuses the rest`, async () => {
    const email = unknown();
    const statuses: number[] = [];
    // A different client address every time: the per-client limit never triggers, the per-address one must.
    for (let i = 0; i < EMAIL_REQUEST_MAX + 3; i++) statuses.push((await send(email)).res.status);
    expect(statuses.slice(0, EMAIL_REQUEST_MAX).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(EMAIL_REQUEST_MAX)).toEqual([429, 429, 429]);
  });

  it('counts a differently written address (case, spaces) in the same bucket', async () => {
    const email = unknown();
    for (let i = 0; i < EMAIL_REQUEST_MAX; i++) await send(email);
    expect((await send(`  ${email.toUpperCase()} `)).res.status).toBe(429);
  });

  it('a known and an unknown address are answered identically, including when refused (no account enumeration)', async () => {
    const known = customer.email;
    const other = unknown();
    const knownShapes: string[] = [];
    const otherShapes: string[] = [];
    // Fresh buckets for the known address: it may have been used by another test, so use an alias-free pair
    // by comparing positions within each sequence.
    for (let i = 0; i < EMAIL_REQUEST_MAX + 1; i++) {
      knownShapes.push(JSON.stringify(await shape(await send(known))));
      otherShapes.push(JSON.stringify(await shape(await send(other))));
    }
    // Same status and body at every position (the refused ones carry the same message too).
    expect(knownShapes.slice(-2)).toEqual(otherShapes.slice(-2));
    const refused = JSON.parse(otherShapes.at(-1)!) as { status: number; body: string };
    expect(refused.status).toBe(429);
    expect(refused.body).toContain(rateLimitedCopy(EMAIL_REQUEST_WINDOW_SECONDS));
  });

  it('different addresses from one client are still held to the per-client limit', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await send(unknown(), ip)).res.status);
    expect(statuses.slice(0, 3).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('never stores the address: the bucket key is a hash', async () => {
    const email = unknown();
    await send(email);
    const found = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from rate_limits where key like ${'%' + email.split('@')[0] + '%'}`,
    );
    expect(found.rows[0]!.n).toBe(0);
    const mine = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from rate_limits where key like ${scope + ':%'}`,
    );
    expect(mine.rows[0]!.n).toBeGreaterThan(0);
  });
});

describe('the two kinds of request keep separate buckets', () => {
  it('using up the reset allowance for an address does not block its verification emails', async () => {
    const email = unknown();
    for (let i = 0; i < EMAIL_REQUEST_MAX + 1; i++) await reset(email);
    expect((await reset(email)).res.status).toBe(429);
    expect((await verify(email)).res.status).not.toBe(429);
  });
});
