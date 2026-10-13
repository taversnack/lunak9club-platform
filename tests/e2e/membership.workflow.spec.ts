import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_CUSTOMER_2, DEMO_OWNER, latestLink, signIn, signOut, uniqueEmail } from './helpers';

// Runs after membership.spec.ts (file order, one worker): the demo dogs already have Monday and Wednesday days.
test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const who = (project: string) =>
  project === 'mobile' ? { user: DEMO_CUSTOMER_2, dog: 'Rex' } : { user: DEMO_CUSTOMER, dog: 'Biscuit' };

test('Owner creates a customer; the customer finishes signing up from the invite link', async ({ page }, info) => {
  const email = uniqueEmail('invited', info.project.name);
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/customers');
  await page.getByRole('link', { name: 'New customer' }).click();
  await expect(page.getByRole('heading', { name: 'New customer', level: 1 })).toBeVisible();
  await axe(page);
  await page.getByLabel('Full name').fill('Ivy Invited');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Dog’s name').first().fill('Pippin');
  await page.getByRole('button', { name: 'Create account and send invite' }).click();
  await expect(page.getByText('We’ve emailed Ivy Invited a link')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finish-signing-up link' })).toBeVisible();
  await axe(page);
  await signOut(page);

  const link = await latestLink(email, 'customer.invite');
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByRole('heading', { name: 'Finish setting up your account', level: 1 })).toBeVisible();
  await axe(page);
  await page.getByLabel('Password', { exact: true }).fill('a-long-e2e-password');
  await page.getByLabel('Confirm password').fill('a-long-e2e-password');
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page).toHaveURL(/\/sign-in\?welcome=1/);
  await axe(page);
  await signIn(page, email, 'a-long-e2e-password');
  await expect(page).toHaveURL(/\/account/);

  // The link is single use.
  await signOut(page);
  await page.goto(new URL(link).pathname + new URL(link).search);
  await expect(page.getByRole('heading', { name: 'Link not valid', level: 1 })).toBeVisible();
  await axe(page);
});

const pad = (n: number) => String(n).padStart(2, '0');
const isoWeekday = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const plus = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

test('customer moves one membership day (this occasion only) and the Owner approves', async ({ page }, info) => {
  const { user, dog } = who(info.project.name);
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/account/bookings');
  // The furthest membership day is always in a later month, so the whole month is open to move into
  // whatever today's date is.
  const links = page.getByRole('link', { name: new RegExp(`^Move ${dog} on`) });
  await expect(links.first()).toBeVisible();
  await links.last().click();
  await expect(page.getByRole('heading', { name: 'Move this membership day', level: 1 })).toBeVisible();
  await axe(page);
  const input = page.getByLabel('New day (this occasion only)');
  const min = (await input.getAttribute('min'))!;
  const max = (await input.getAttribute('max'))!;
  let to = min;
  while (to <= max && ![2, 4, 5].includes(isoWeekday(to))) to = plus(to, 1); // not the dog's Mon/Wed
  expect(to <= max).toBe(true);
  await page.getByRole('radio', { name: 'This occasion only' }).check();
  await input.fill(to);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/moveRequested=1/);
  await expect(page.getByText('Move waiting for approval').first()).toBeVisible();
  await axe(page);
  await signOut(page);

  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto('/admin/approvals');
  await page.getByRole('button', { name: new RegExp(`^Approve ${dog}: move`) }).click();
  await expect(page).toHaveURL(/approved=1/);
  await signOut(page);
});

test('“all future months” from the move page goes to changing the regular days', async ({ page }, info) => {
  const { user, dog } = who(info.project.name);
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/account/bookings');
  await page
    .getByRole('link', { name: new RegExp(`^Move ${dog} on`) })
    .first()
    .click();
  await page.getByRole('radio', { name: 'All future months (change my regular days)' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/account\/membership#yours/);
  await axe(page);
});
