import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { users } from '@/infra/db/schema';
import { getUserRoles } from '@/server/roles';
import { MemoryEmailProvider, linkFrom } from '../support/memory-email';
import { authRequest } from '../support/auth-http';

const mail = new MemoryEmailProvider();
beforeAll(() => setEmailProvider(mail));
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

const email = 'casey.flow@example.test';
const password = 'a-long-password-1';

async function tokenPath(url: string) {
  const u = new URL(url);
  return u.pathname.replace('/api/auth', '') + u.search;
}

describe('registration, verification, sign-in and reset', () => {
  it('registers a customer, sends a verification email and audits it', async () => {
    const { res } = await authRequest('/sign-up/email', {
      body: { name: 'Casey Flow', email, password, callbackURL: '/dashboard' },
    });
    expect(res.status).toBe(200);
    const [u] = await getDb().select().from(users).where(eq(users.email, email));
    expect(u?.emailVerified).toBe(false);
    expect(await getUserRoles(getDb(), u!.id)).toEqual(['customer']);
    expect(mail.lastTo(email)?.template).toBe('auth.verify-email');
    const audit = await getDb().execute<{ action: string }>(
      sql`select action from audit_events where entity_id = ${u!.id}`,
    );
    expect(audit.rows.map((r) => r.action)).toContain('auth.registered');
  });

  it('refuses sign-in until the email is verified', async () => {
    const { res } = await authRequest('/sign-in/email', { body: { email, password } });
    expect(res.status).toBe(403);
  });

  it('verifies the email from the link and then allows sign-in', async () => {
    const link = linkFrom(mail.lastTo(email));
    const { res } = await authRequest(await tokenPath(link), { method: 'GET' });
    expect([200, 302]).toContain(res.status);
    const [u] = await getDb().select().from(users).where(eq(users.email, email));
    expect(u?.emailVerified).toBe(true);

    const signIn = await authRequest('/sign-in/email', { body: { email, password } });
    expect(signIn.res.status).toBe(200);
    const session = await authRequest('/get-session', { method: 'GET', cookie: signIn.cookie });
    const body = (await session.res.json()) as { user?: { email: string } } | null;
    expect(body?.user?.email).toBe(email);
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    const wrong = await authRequest('/sign-in/email', { body: { email, password: 'not-the-password' } });
    const unknown = await authRequest('/sign-in/email', {
      body: { email: 'nobody@example.test', password: 'not-the-password' },
    });
    expect(wrong.res.status).toBe(401);
    expect(unknown.res.status).toBe(401);
  });

  it('resets the password with the emailed token and revokes old sessions', async () => {
    const before = await authRequest('/sign-in/email', { body: { email, password } });
    await authRequest('/request-password-reset', { body: { email, redirectTo: '/reset-password' } });
    const msg = mail.lastTo(email);
    expect(msg?.template).toBe('auth.reset-password');
    const u = new URL(linkFrom(msg));
    const token = u.pathname.split('/').pop()!;
    const reset = await authRequest('/reset-password', { body: { newPassword: 'another-long-password-2', token } });
    expect(reset.res.status).toBe(200);

    const oldSession = await authRequest('/get-session', { method: 'GET', cookie: before.cookie });
    expect(await oldSession.res.json()).toBeNull();
    expect((await authRequest('/sign-in/email', { body: { email, password } })).res.status).toBe(401);
    expect(
      (await authRequest('/sign-in/email', { body: { email, password: 'another-long-password-2' } })).res.status,
    ).toBe(200);

    // A reset token cannot be reused.
    const reuse = await authRequest('/reset-password', { body: { newPassword: 'third-long-password-3', token } });
    expect(reuse.res.status).toBeGreaterThanOrEqual(400);
  });

  it('rate-limits repeated sign-in attempts from one address', async () => {
    const ip = '192.0.2.77';
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (await authRequest('/sign-in/email', { ip, body: { email, password: 'wrong-password-xx' } })).res.status,
      );
    }
    expect(statuses).toContain(429);
  });

  it('does not reveal whether an email is already registered', async () => {
    const again = await authRequest('/sign-up/email', {
      body: { name: 'Someone Else', email, password: 'yet-another-password' },
    });
    expect(again.res.status).toBe(200);
    const rows = await getDb().select().from(users).where(eq(users.email, email));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Casey Flow');
  });

  it('rejects passwords shorter than 10 characters', async () => {
    const { res } = await authRequest('/sign-up/email', {
      body: { name: 'Short', email: 'short@example.test', password: 'short1' },
    });
    expect(res.status).toBe(400);
  });
});
