import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

const MAIL_DIR = '.tmp/e2e-mail';

export const DEMO_OWNER = { email: 'owner@lunak9club.test', password: 'demo-owner-password' };
export const DEMO_CUSTOMER = { email: 'casey@example.test', password: 'demo-customer-password' };
export const DEMO_CUSTOMER_2 = { email: 'jordan@example.test', password: 'demo-customer-password' };

export function uniqueEmail(prefix: string, project: string) {
  return `${prefix}.${project}.${Date.now()}@example.test`;
}

type MailFile = { to: string; template: string; text: string; html: string; subject: string };

/**
 * Messages in the test mail folder, newest first. Only finished files (`*.json`; the transport writes
 * `*.json.tmp` then renames) are read, and one that can't be parsed is skipped rather than failing.
 */
function mailNewestFirst(): MailFile[] {
  if (!existsSync(MAIL_DIR)) return [];
  const out: MailFile[] = [];
  for (const f of readdirSync(MAIL_DIR)
    .filter((x) => x.endsWith('.json'))
    .sort()
    .reverse()) {
    try {
      out.push(JSON.parse(readFileSync(join(MAIL_DIR, f), 'utf8')) as MailFile);
    } catch {
      // removed or unreadable meanwhile: ignore
    }
  }
  return out;
}

/** The most recent email sent to `to` for a template (polls briefly). */
export async function latestEmail(to: string, template: string): Promise<MailFile> {
  for (let i = 0; i < 30; i++) {
    const m = mailNewestFirst().find((x) => x.to === to && x.template === template);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No ${template} email for ${to}`);
}

/** The link in the newest email sent to `to` for a template (polls briefly). */
export async function latestLink(to: string, template: string): Promise<string> {
  const link = (await latestEmail(to, template)).text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error(`No link in the latest ${template} email for ${to}`);
  return link;
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Sign in with a password instead' }).click();
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Opens the app menu (drawer) when needed, then follows a link in the named navigation. */
export async function navTo(page: Page, area: string, name: string, exact = false) {
  const link = page.getByRole('navigation', { name: area }).getByRole('link', { name, exact });
  if (!(await link.first().isVisible())) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await link.first().click();
}

export async function signOut(page: Page) {
  const btn = page.getByRole('button', { name: 'Sign out' });
  if (!(await btn.first().isVisible())) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await btn.first().click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/**
 * Test-only: move a demo dog's vaccination expiry in the e2e test database (to rehearse a
 * vaccination block without waiting months). Returns the previous expiry so it can be restored.
 */
export async function setVaccinationExpiry(dogName: string, requirementKey: string, expiresOn: string) {
  const { Client } = await import('pg');
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://lunak9:lunak9@localhost:5432/lunak9_test';
  if (!/test/.test(new URL(url).pathname)) throw new Error('Only for a *test* database');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query<{ expires_on: string }>(
      `update compliance_submissions s set expires_on = $3
         from dogs d, compliance_submissions old
        where d.id = s.dog_id and d.name = $1 and s.requirement_key = $2 and old.id = s.id
          and s.status = 'approved'
        returning to_char(old.expires_on, 'YYYY-MM-DD') as expires_on`,
      [dogName, requirementKey, expiresOn],
    );
    return r.rows[0]?.expires_on ?? null;
  } finally {
    await c.end();
  }
}

/**
 * After a card payment the address bar must show a real page (e.g. /account/bookings?payment=paid),
 * not /api/payments/return or the simulated checkout's own POST URLs.
 */
export async function expectLandedAfterPayment(page: Page, pathname: string | RegExp, payment = 'paid') {
  await expect(page).toHaveURL(
    (u) =>
      !u.pathname.startsWith('/api/') &&
      !u.pathname.startsWith('/dev/checkout/') &&
      (typeof pathname === 'string' ? u.pathname === pathname : pathname.test(u.pathname)) &&
      u.searchParams.get('payment') === payment,
  );
}
