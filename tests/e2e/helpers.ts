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
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/**
 * Test-only: move a demo dog's vaccination expiry in the e2e test database (to rehearse a
 * vaccination block without waiting months). Returns the previous expiry so it can be restored.
 */
export async function setVaccinationExpiry(dogName: string, requirementKey: string, expiresOn: string) {
  const { Client } = await import('pg');
  // Never guess: a default would point at whichever shared test database happens to be on 5432.
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('setVaccinationExpiry needs TEST_DATABASE_URL (the e2e test database) – it is not set.');
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
