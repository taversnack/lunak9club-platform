/**
 * Magic-link sign-in (customers only): single use, 10-minute expiry, the safe callbackUrl from #50,
 * the Owner refused, no account enumeration and a rate limit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { users, verifications } from '@/infra/db/schema';
import { MAGIC_LINK_MINUTES } from '@/infra/auth/auth';
import { MemoryEmailProvider, linkFrom } from '../support/memory-email';
import { authRequest, freshIp } from '../support/auth-http';
import { makeUser, type TestUser } from '../support/factories';

const mail = new MemoryEmailProvider();
const db = () => getDb();
let customer: TestUser;
let owner: TestUser;

beforeAll(async () => {
  setEmailProvider(mail);
  customer = await makeUser(db(), 'customer', 'Mags Link');
  owner = await makeUser(db(), 'owner', 'Olive Owner');
});
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

/** The emailed link as a path under /api/auth, ready for authRequest. */
const authPath = (url: string) => {
  const u = new URL(url);
  return u.pathname.replace('/api/auth', '') + u.search;
};
const request = (email: string, callbackURL?: string, ip = freshIp()) =>
  authRequest('/sign-in/magic-link', { body: { email, ...(callbackURL ? { callbackURL } : {}) }, ip });
/** Let the background email send settle. */
const settle = () => new Promise((r) => setTimeout(r, 50));
const sessionFor = async (cookie: string) => {
  const r = await authRequest('/get-session', { method: 'GET', cookie });
  return ((await r.res.json()) as { user?: { email: string } } | null)?.user?.email ?? null;
};
async function linkFor(email: string, callbackURL?: string) {
  const before = mail.sent.length;
  const { res } = await request(email, callbackURL);
  expect(res.status).toBe(200);
  await settle();
  const m = mail.sent.slice(before).find((x) => x.to === email);
  expect(m?.template).toBe('auth.magic-link');
  return linkFrom(m);
}

describe('magic-link sign-in', () => {
  it('signs a customer in once and lands on the safe callbackUrl', async () => {
    const target = '/api/payments/pay/0b8f3c1e?from=email';
    const link = await linkFor(customer.email, target);
    expect(link).toContain('/api/auth/magic-link/verify?token=');
    expect(new URL(link).searchParams.get('callbackURL')).toBe(target);

    const first = await authRequest(authPath(link), { method: 'GET' });
    expect(first.res.status).toBe(302);
    expect(
      new URL(first.res.headers.get('location')!).pathname + new URL(first.res.headers.get('location')!).search,
    ).toBe(target);
    expect(await sessionFor(first.cookie)).toBe(customer.email);

    // Single use: the same link again is refused and keeps the way back for a fresh sign-in.
    const again = await authRequest(authPath(link), { method: 'GET' });
    expect(again.res.status).toBe(302);
    const loc = new URL(again.res.headers.get('location')!);
    expect(loc.pathname).toBe('/sign-in');
    expect(loc.searchParams.get('callbackUrl')).toBe(target);
    expect(loc.searchParams.get('error')).toBe('INVALID_TOKEN');
    expect(again.cookie).not.toMatch(/session_token=[^;]+/);
  });

  it(`expires after ${MAGIC_LINK_MINUTES} minutes`, async () => {
    const link = await linkFor(customer.email, '/account/bookings');
    const token = new URL(link).searchParams.get('token')!;
    // better-auth ≥1.7.7 namespaces the key (GHSA-965c-763c-88jm) so OAuth state can't be used as a Magic Link token.
    const hashed = `magic-link:${createHash('sha256').update(token).digest('base64url')}`;
    const [row] = await db().select().from(verifications).where(eq(verifications.identifier, hashed));
    expect(row, 'token is stored hashed, not in plain text').toBeTruthy();
    expect(
      await db()
        .select()
        .from(verifications)
        .where(eq(verifications.identifier, `magic-link:${token}`)),
    ).toEqual([]);
    const minutes = (row!.expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(MAGIC_LINK_MINUTES - 1);
    expect(minutes).toBeLessThanOrEqual(MAGIC_LINK_MINUTES);
    expect(MAGIC_LINK_MINUTES).toBeGreaterThanOrEqual(10);
    expect(MAGIC_LINK_MINUTES).toBeLessThanOrEqual(15);

    await db()
      .update(verifications)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verifications.identifier, hashed));
    const r = await authRequest(authPath(link), { method: 'GET' });
    expect(new URL(r.res.headers.get('location')!).searchParams.get('error')).toBe('INVALID_TOKEN');
    expect(r.cookie).not.toMatch(/session_token=[^;]+/);
  });

  it('never carries an off-site callback, when requested or when the link is edited', async () => {
    const link = await linkFor(customer.email, '//evil.example/steal');
    expect(new URL(link).searchParams.get('callbackURL')).toBe('/dashboard');
    const edited = new URL(link);
    edited.searchParams.set('callbackURL', 'https://evil.example/');
    const r = await authRequest(authPath(edited.toString()), { method: 'GET' });
    expect(r.res.status).toBe(302);
    const loc = new URL(r.res.headers.get('location')!, 'http://localhost:3000');
    expect(loc.origin).toBe('http://localhost:3000');
    expect(loc.pathname).toBe('/dashboard');
  });

  it.each([
    ['malformed escape', '%E0%A4%A'],
    ['double-encoded malformed escape', '%25E0%25A4%25A'],
    ['lone percent', '%'],
  ])('a %s in the callbackURL falls back to /dashboard instead of failing (was HTTP 500)', async (_l, raw) => {
    const r = await authRequest(`/magic-link/verify?token=not-a-real-token&callbackURL=${raw}`, { method: 'GET' });
    expect(r.res.status).toBe(302);
    const loc = new URL(r.res.headers.get('location')!, 'http://localhost:3000');
    expect(loc.pathname).toBe('/sign-in');
    expect(loc.searchParams.get('callbackUrl')).toBe('/dashboard');
    expect(loc.searchParams.get('error')).toBe('INVALID_TOKEN');
  });

  it('gives unknown, owner and unconfirmed addresses the same response and sends them nothing', async () => {
    const unverified = `unverified.${randomUUID().slice(0, 8)}@example.test`;
    await db()
      .insert(users)
      .values({ id: randomUUID(), name: 'Una Verified', email: unverified, emailVerified: false });
    const bodies: unknown[] = [];
    for (const email of [customer.email, 'nobody.at.all@example.test', owner.email, unverified]) {
      const before = mail.sent.length;
      const { res } = await request(email, '/account');
      expect(res.status).toBe(200);
      bodies.push(await res.json());
      await settle();
      const sent = mail.sent.slice(before).filter((m) => m.to === email).length;
      expect(sent, email).toBe(email === customer.email ? 1 : 0);
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });

  it('refuses the Owner even with a valid token (second line of defence)', async () => {
    const token = `forged${randomUUID().replace(/-/g, '')}`;
    await db()
      .insert(verifications)
      .values({
        id: randomUUID(),
        identifier: createHash('sha256').update(token).digest('base64url'),
        value: JSON.stringify({ email: owner.email }),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      });
    const r = await authRequest(`/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent('/admin')}`, {
      method: 'GET',
    });
    expect(r.res.status).toBe(302);
    expect(new URL(r.res.headers.get('location')!).searchParams.get('error')).toBeTruthy();
    expect(r.cookie).not.toMatch(/session_token=[^;]+/);
    const audit = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from audit_events where entity_id = ${owner.userId} and action = 'auth.magic_link_refused'`,
    );
    expect(audit.rows[0]!.n).toBeGreaterThan(0);
  });

  it('rate-limits requests from one address', async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await request(customer.email, undefined, ip)).res.status);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses).toContain(429);
  });
});
