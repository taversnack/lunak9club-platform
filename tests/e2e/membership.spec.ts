import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_CUSTOMER_2, DEMO_OWNER, signIn, signOut } from './helpers';

test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

// Mobile uses Jordan's dog Rex; desktop uses Casey's dog Biscuit (seeded, both approved).
const who = (project: string) =>
  project === 'mobile' ? { user: DEMO_CUSTOMER_2, dog: 'Rex' } : { user: DEMO_CUSTOMER, dog: 'Biscuit' };

test('customer sees prices and asks for a 2-day membership', async ({ page }, info) => {
  const { user, dog } = who(info.project.name);
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Membership' }).click();
  await expect(page.getByRole('heading', { name: 'Membership', level: 1 })).toBeVisible();
  const prices = page.getByRole('region', { name: 'Prices', exact: true });
  await expect(prices).toContainText('£50.00');
  await expect(prices).toContainText('£48.00');
  await expect(prices).toContainText('£45.00');
  await expect(prices).toContainText('£22.50');
  await axe(page);

  const join = page.getByRole('region', { name: 'Become a member' });
  await join.getByLabel('Dog', { exact: true }).selectOption({ label: dog });
  await join.getByRole('checkbox', { name: 'Monday' }).check();
  await join.getByRole('checkbox', { name: 'Wednesday' }).check();
  await join.getByRole('button', { name: 'Ask to join' }).click();
  await expect(page.getByText('we’ll review your membership request').first()).toBeVisible();
  await expect(page.getByText('Waiting for Luna’s K9 Club').first()).toBeVisible();
  await signOut(page);
});

test('Owner approves and the days are booked at the member rate', async ({ page }, info) => {
  const { user, dog } = who(info.project.name);
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: 'Owner' }).getByRole('link', { name: 'Memberships' }).click();
  await axe(page);
  await page.getByRole('button', { name: `Approve ${dog}` }).click();
  await expect(page.getByText(/Approved\. \d+ days booked/)).toBeVisible();
  await page.goto('/admin/settings/pricing');
  await expect(page.getByText('In use')).toBeVisible();
  await axe(page);
  await signOut(page);

  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/account/bookings');
  const row = page.getByRole('row').filter({ hasText: 'Membership day' }).first();
  await expect(row).toContainText(dog);
  await expect(row).toContainText('£48.00');
  await page.goto('/account/membership');
  await expect(page.getByText('Active').first()).toBeVisible();
  await axe(page);
});

const customerName = (project: string) => (project === 'mobile' ? 'Jordan Second' : 'Casey Customer');

test('Owner checks the membership invoice draft and sends it', async ({ page }, info) => {
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  // Send approved invoices immediately in this test run (draft and send on day 1 at 00:00).
  await page.goto('/admin/settings/business');
  await axe(page);
  await page.getByLabel('Drafts ready on day').fill('1');
  await page.getByLabel('Send on day').fill('1');
  await page.getByLabel('Send at (24-hour)').fill('00:00');
  await page.getByRole('button', { name: 'Save business details' }).click();
  await expect(page.getByText('Business details saved.')).toBeVisible();

  await page.getByRole('navigation', { name: 'Owner' }).getByRole('link', { name: 'Invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Update drafts and send anything due now' }).click();
  await expect(page.getByText(/Billing updated/)).toBeVisible();
  await axe(page);
  await page
    .getByRole('link', { name: customerName(info.project.name) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /Draft invoice/, level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Invoice days' })).toContainText('£48.00');
  await axe(page);
  await page.getByRole('button', { name: /Approve invoice for £/ }).click();
  await expect(page.getByText('Approved and sent. The customer has been emailed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Invoice LK9DOUGIE-\d{2,}/, level: 1 })).toBeVisible();
  await axe(page);
  await signOut(page);
});

test('customer sees the invoice and can download the PDF', async ({ page }, info) => {
  const { user } = who(info.project.name);
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Invoices' }).click();
  await expect(page.getByRole('heading', { name: 'Your invoices', level: 1 })).toBeVisible();
  await axe(page);
  await page
    .getByRole('link', { name: /LK9DOUGIE-\d{2,}/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /Invoice LK9DOUGIE-/, level: 1 })).toBeVisible();
  await expect(page.getByText('Unpaid').first()).toBeVisible();
  await axe(page);
  const href = await page.getByRole('link', { name: 'Download PDF' }).getAttribute('href');
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  // Pay it by card (simulated Stripe page in tests).
  await page.getByRole('button', { name: /Pay £\d+\.\d\d by card/ }).click();
  await expect(page.getByRole('heading', { name: 'Test card payment' })).toBeVisible();
  await page.getByRole('button', { name: /with a test card/ }).click();
  await expect(page.getByText('Payment received', { exact: true })).toBeVisible();
  await expect(page.getByText('Paid').first()).toBeVisible();
  await axe(page);
  // Another customer can't open it.
  await signOut(page);
  const other = info.project.name === 'mobile' ? DEMO_CUSTOMER : DEMO_CUSTOMER_2;
  await signIn(page, other.email, other.password);
  await expect(page).toHaveURL(/\/account$/);
  expect((await page.request.get(href!)).status()).toBe(404);
});
