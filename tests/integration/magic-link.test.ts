/**
 * Magic-link sign-in (customers only): single use, 10-minute expiry, the safe callbackUrl from #50,
 * the Owner refused, no account enumeration and a rate limit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { users, verifications } from '@/infra/db/schema';
import { MAGIC_LINK_MINUTES } from '@/infra/auth/auth';
import { logger } from '@/infra/logger';
import { MAGIC_LINK_MAX, MAGIC_LINK_WINDOW_SECONDS } from '@/domain/auth/rate-limits';
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
// Each test starts with fresh per-address counts (the per-address limit has its own tests below).
beforeEach(async () => {
  await db().execute(sql`delete from rate_limits where key like 'magic-link-email:%'`);
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
/** One browser's magic-link cookie (set on its first request), like a real browser keeps it. */
type Browser = { cookie?: string };
const newBrowser = (): Browser => ({});
async function request(email: string, callbackURL?: string, ip = freshIp(), browser?: Browser) {
  const r = await authRequest('/sign-in/magic-link', {
    body: { email, ...(callbackURL ? { callbackURL } : {}) },
    ip,
    ...(browser?.cookie ? { cookie: browser.cookie } : {}),
  });
  const set = r.cookie.split('; ').find((c) => c.startsWith('lk9_ml_browser='));
  if (browser && set) browser.cookie = set;
  return r;
}
/** Let the background email send settle. */
const settle = () => new Promise((r) => setTimeout(r, 50));
const sessionFor = async (cookie: string) => {
  const r = await authRequest('/get-session', { method: 'GET', cookie });
  return ((await r.res.json()) as { user?: { email: string } } | null)?.user?.email ?? null;
};
async function linkFor(email: string, callbackURL?: string, browser?: Browser) {
  const before = mail.sent.length;
  const { res } = await request(email, callbackURL, freshIp(), browser);
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

  it('“Send the link again” revokes the earlier link; only the newest works, and other people’s links are unaffected', async () => {
    const other = await makeUser(db(), 'customer', 'Otto Other');
    const otherLink = await linkFor(other.email);
    const mine = newBrowser();
    const a = await linkFor(customer.email, '/account/bookings', mine);
    expect(mine.cookie).toMatch(/^lk9_ml_browser=[A-Za-z0-9_-]{32}$/);
    const b = await linkFor(customer.email, '/account/bookings', mine);

    const useA = await authRequest(authPath(a), { method: 'GET' });
    expect(useA.res.status).toBe(302);
    expect(new URL(useA.res.headers.get('location')!).searchParams.get('error')).toBe('INVALID_TOKEN');
    expect(useA.cookie).not.toMatch(/session_token=[^;]+/);

    const useB = await authRequest(authPath(b), { method: 'GET' });
    expect(useB.res.status).toBe(302);
    expect(new URL(useB.res.headers.get('location')!).pathname).toBe('/account/bookings');
    expect(await sessionFor(useB.cookie)).toBe(customer.email);

    const useOther = await authRequest(authPath(otherLink), { method: 'GET' });
    expect(await sessionFor(useOther.cookie)).toBe(other.email);
  });

  it('a request for an unknown address revokes nothing', async () => {
    const link = await linkFor(customer.email);
    const { res } = await request(`nobody-${randomUUID()}@example.test`);
    expect(res.status).toBe(200);
    await settle();
    const use = await authRequest(authPath(link), { method: 'GET' });
    expect(await sessionFor(use.cookie)).toBe(customer.email);
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

  it('rate-limits requests for one email address from any number of IPs, keeping its emailed link alive (Tester, #109 F1)', async () => {
    const victim = await makeUser(db(), 'customer', 'Vic Tim');
    const link = await linkFor(victim.email); // 1 of MAGIC_LINK_MAX
    const statuses: number[] = [];
    // Upper case is the same address; every request comes from a fresh IP.
    for (let i = 0; i < MAGIC_LINK_MAX + 1; i++)
      statuses.push((await request(i % 2 ? victim.email.toUpperCase() : victim.email)).res.status);
    expect(statuses).toEqual([...Array(MAGIC_LINK_MAX - 1).fill(200), 429, 429]);
    const limited = await request(victim.email);
    expect(limited.res.status).toBe(429);
    expect(((await limited.res.json()) as { message?: string }).message).toBe(
      'Too many requests. Please wait 5 minutes and try again.',
    );
    await settle();
    // The refused requests didn't revoke anything: the newest link that was sent still works.
    const newest = mail.sent.filter((m) => m.to === victim.email).at(-1);
    const { res } = await authRequest(authPath(linkFrom(newest)), { method: 'GET' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').not.toContain('error');
    expect(link).toBeTruthy();
  });

  it('limits unknown addresses the same way, so a 429 does not reveal whether an account exists', async () => {
    const statusesFor = async (email: string) => {
      const out: number[] = [];
      for (let i = 0; i <= MAGIC_LINK_MAX; i++) out.push((await request(email)).res.status);
      return out;
    };
    const known = await makeUser(db(), 'customer', 'Kay Known');
    const expected = [...Array(MAGIC_LINK_MAX).fill(200), 429];
    expect(await statusesFor(known.email)).toEqual(expected);
    expect(await statusesFor(`nobody-${randomUUID()}@example.com`)).toEqual(expected);
  });

  it('counts per address without storing the address, and starts again after the window', async () => {
    const who = await makeUser(db(), 'customer', 'Win Dow');
    for (let i = 0; i < MAGIC_LINK_MAX; i++) expect((await request(who.email)).res.status).toBe(200);
    expect((await request(who.email)).res.status).toBe(429);
    const rows = await db().execute<{ key: string }>(
      sql`select key from rate_limits where key like 'magic-link-email:%'`,
    );
    expect(rows.rows.some((r) => r.key.includes(who.email) || r.key.includes('@'))).toBe(false);
    // Age the window out.
    await db().execute(
      sql`update rate_limits set last_request = last_request - ${(MAGIC_LINK_WINDOW_SECONDS + 1) * 1000} where key like 'magic-link-email:%'`,
    );
    expect((await request(who.email)).res.status).toBe(200);
  });

  const live = async (link: string) => {
    const token = new URL(link).searchParams.get('token')!;
    const h = createHash('sha256').update(token).digest('base64url');
    const r = await db().execute(
      sql`select 1 from verifications where identifier in (${h}, ${'magic-link:' + h}) and expires_at > now()`,
    );
    return r.rows.length === 1;
  };

  it('strangers asking for links to your address can neither kill your link nor stop you resending (Tester #113 F1)', async () => {
    const jordan = await makeUser(db(), 'customer', 'Jo Rdan');
    const browser = newBrowser();
    const kept = await linkFor(jordan.email, undefined, browser);
    // An attacker from rotating IPs, no cookie (or a cookie of their own): spends the shared bucket.
    const attacker = newBrowser();
    const statuses: number[] = [];
    for (let i = 0; i < MAGIC_LINK_MAX + 1; i++)
      statuses.push((await request(jordan.email, undefined, freshIp(), i % 2 ? attacker : undefined)).res.status);
    expect(statuses).toContain(429);
    await settle();
    expect(await live(kept)).toBe(true); // not revoked by anyone else's request
    // Jordan resends from his browser: allowed (his own bucket), and it replaces his earlier link.
    const fresh = await linkFor(jordan.email, undefined, browser);
    expect(await live(kept)).toBe(false);
    const use = await authRequest(authPath(fresh), { method: 'GET' });
    expect(await sessionFor(use.cookie)).toBe(jordan.email);
  });

  it('a browser resending is still limited, in its own bucket', async () => {
    const who = await makeUser(db(), 'customer', 'Res Ender');
    const browser = newBrowser();
    await linkFor(who.email, undefined, browser); // shared bucket: 1
    const statuses: number[] = [];
    for (let i = 0; i < MAGIC_LINK_MAX + 1; i++)
      statuses.push((await request(who.email, undefined, freshIp(), browser)).res.status);
    expect(statuses).toEqual([...Array(MAGIC_LINK_MAX).fill(200), 429]);
  });

  it('a forged browser cookie is ignored (treated as a new browser)', async () => {
    const who = await makeUser(db(), 'customer', 'For Ged');
    const browser = newBrowser();
    const kept = await linkFor(who.email, undefined, browser);
    await request(who.email, undefined, freshIp(), { cookie: 'lk9_ml_browser=not-a-real-id' });
    await settle();
    expect(await live(kept)).toBe(true);
  });
});

describe('logging when the sign-in email fails', () => {
  it('records only the error name, never the address (it can appear in a mail server error)', async () => {
    const email = customer.email;
    setEmailProvider({
      name: 'failing',
      send: async () => {
        throw new Error(`550 Recipient address rejected: ${email}`);
      },
    });
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      await request(email);
      await settle();
      await settle();
      const logged = JSON.stringify(spy.mock.calls);
      expect(spy).toHaveBeenCalled();
      expect(logged).not.toContain(email);
      expect(logged).not.toContain('Recipient address rejected');
      expect(logged).toContain('magic-link email failed');
    } finally {
      spy.mockRestore();
      setEmailProvider(mail);
    }
  });
});
