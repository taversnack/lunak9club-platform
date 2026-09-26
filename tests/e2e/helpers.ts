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

/** Latest link in the most recent email sent to `to` for a template (polls briefly). */
export async function latestLink(to: string, template: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    if (existsSync(MAIL_DIR)) {
      const msgs = readdirSync(MAIL_DIR)
        .sort()
        .reverse()
        .map(
          (f) => JSON.parse(readFileSync(join(MAIL_DIR, f), 'utf8')) as { to: string; template: string; text: string },
        );
      const m = msgs.find((x) => x.to === to && x.template === template);
      const link = m?.text.match(/https?:\/\/\S+/)?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No ${template} email for ${to}`);
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
