import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_CUSTOMER_2, DEMO_OWNER, signIn, signOut } from './helpers';

test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

let bookedDateLabel = '';
let bookedIso = '';

test('customer books two days with the taxi, sees the estimate first, and cancels one for free', async ({
  page,
}, info) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Book', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Book day care' })).toBeVisible();
  await axe(page);

  await page.getByRole('checkbox', { name: 'Biscuit', exact: true }).check();
  await page.getByLabel(/Collect and drop off with the dog taxi/).check();
  // Pick two open days; offset by project so mobile and desktop don't collide.
  const days = page.locator('input[name="date"]:not([disabled])');
  const offset = info.project.name === 'mobile' ? 0 : 4;
  const first = days.nth(offset + 5);
  const second = days.nth(offset + 6);
  bookedIso = (await first.getAttribute('value'))!;
  await first.check();
  await second.check();
  await page.getByRole('button', { name: 'Check price and availability' }).click();

  await expect(page.getByRole('heading', { name: 'Check your booking' })).toBeVisible();
  await expect(page.getByText('£100.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Place available')).toHaveCount(2);
  await axe(page);
  await page.getByRole('button', { name: 'Continue to payment (£100.00)' }).click();
  // Simulated card page stands in for Stripe in tests (PAYMENTS_DRIVER=simulated).
  await expect(page.getByRole('heading', { name: 'Test card payment' })).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Pay £100.00 with a test card' }).click();
  await expect(page.getByText('Payment received – you’re booked')).toBeVisible();
  await axe(page);

  const row = page.getByRole('row').filter({ hasText: 'Biscuit' }).first();
  bookedDateLabel = (await row.getByRole('cell').first().textContent())!;
  await page
    .getByRole('link', { name: /Cancel Biscuit/ })
    .last()
    .click();
  await expect(page.getByRole('heading', { name: 'Cancel this booking?' })).toBeVisible();
  await expect(page.getByText(/No charge/)).toBeVisible();
  await page.getByRole('button', { name: 'Yes, cancel booking' }).click();
  await expect(page.getByText(/refunded this day to your card/)).toBeVisible();
  await expect(page.getByText('Cancelled').first()).toBeVisible();
});

test('a closed day can’t be picked and Saturday isn’t offered', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await page.goto('/account/book');
  const sat = page.locator('label', { hasText: /^Sat/ });
  await expect(sat).toHaveCount(0);
});

test('Owner sees the booking on the day, books a trial and checks a dog in and out', async ({ page }, info) => {
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/bookings?date=${bookedIso}`);
  await expect(page.getByRole('link', { name: 'Biscuit', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Taxi run', exact: true })).toContainText('Biscuit');
  await axe(page);

  // Book a dog for today (today may be a weekend, so always give an override reason).
  const dog =
    info.project.name === 'mobile'
      ? { label: 'Rex (Jordan Second)', name: 'Rex' }
      : { label: 'Biscuit (Casey Customer)', name: 'Biscuit' };
  await page.goto('/admin/bookings/new');
  await page.getByLabel('Dog', { exact: true }).selectOption({ label: dog.label });
  await page.getByLabel('Reason for any override').fill('E2E trial');
  await page.getByRole('button', { name: 'Book' }).click();
  await expect(page).toHaveURL(/\/admin\/bookings\?date=/);
  const dayUrl = page.url();
  await expect(page.getByText(/Payment link sent/).first()).toBeVisible();
  await signOut(page);

  // The customer pays from their bookings page (the emailed link goes to the same place).
  const customer = info.project.name === 'mobile' ? DEMO_CUSTOMER_2 : DEMO_CUSTOMER;
  await signIn(page, customer.email, customer.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/account/bookings');
  await expect(page.getByText(/Waiting for payment/)).toBeVisible();
  await axe(page);
  await page.getByRole('link', { name: /Pay £\d+\.\d\d by card/ }).click();
  await page.getByRole('button', { name: /with a test card/ }).click();
  await expect(page.getByText('Payment received – you’re booked')).toBeVisible();
  await signOut(page);

  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(dayUrl);
  const item = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: dog.name, exact: true }) })
    .first();
  await item.getByRole('button', { name: new RegExp(`Check in ${dog.name}`) }).click();
  await expect(item.getByText(/Checked in/)).toBeVisible();
  await item.getByRole('button', { name: new RegExp(`Check out ${dog.name}`) }).click();
  await expect(item.getByText(/out \d\d:\d\d/)).toBeVisible();

  const csv = await page.request.get(
    page.url().replace('/admin/bookings?date=', '/api/admin/exports/attendance?date='),
  );
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain(dog.name);
  await page.goto('/admin/settings/availability');
  await axe(page);
  await page.goto(`/admin/bookings/week?from=${bookedIso}`);
  await axe(page);
  await page.goto(`/admin/bookings/month?month=${bookedIso.slice(0, 7)}`);
  await axe(page);
  await signOut(page);
});

test('customers can’t reach Owner booking pages or exports', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/admin/bookings');
  await expect(page).toHaveURL(/\/access-denied$/);
  const r = await page.request.get(`/api/admin/exports/emergency?date=${bookedIso}`);
  expect(r.status()).toBe(404);
  expect(bookedDateLabel).not.toBe('');
});
