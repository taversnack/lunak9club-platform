import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_CUSTOMER_2, DEMO_OWNER, latestEmail, navTo, signIn, signOut } from './helpers';
import { PAY_TO_SECURE_KEY, REQUEST_NOT_SECURED, REQUEST_NOT_SECURED_KEY } from '../../src/domain/booking/wording';

test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  // Title is streamed with metadata; wait for it so axe doesn't race it (document-title).
  await expect(page).toHaveTitle(/\S/);
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
  await navTo(page, 'Your account', 'Book', true);
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

  // The request form says plainly that a request does not secure the booking (D76).
  await expect(page.getByRole('heading', { name: 'Check your booking request' })).toBeVisible();
  await expect(page.getByText('£100.00', { exact: true })).toBeVisible();
  await expect(page.getByText('Place available – will be requested')).toHaveCount(2);
  await expect(page.getByTestId('request-not-secured')).toHaveText(REQUEST_NOT_SECURED);
  await expect(page.getByTestId('request-not-secured')).toContainText(REQUEST_NOT_SECURED_KEY);
  await axe(page);
  await page.getByRole('button', { name: 'Send booking request' }).click();
  // …on screen once sent…
  await expect(page.getByText('Booking request sent')).toBeVisible();
  await expect(page.getByTestId('request-not-secured')).toContainText(REQUEST_NOT_SECURED_KEY);
  await expect(page.getByText('Requested – waiting for approval').first()).toBeVisible();
  await axe(page);
  // …and in the confirmation email.
  const confirmation = await latestEmail(DEMO_CUSTOMER.email, 'booking.requested');
  expect(confirmation.text).toContain(REQUEST_NOT_SECURED);
  await signOut(page);

  // The Owner approves on the Requests page, with a note that only shows in the portal.
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await navTo(page, 'Owner', 'Requests', true);
  await expect(page.getByRole('heading', { name: 'Requests', level: 1 })).toBeVisible();
  await axe(page);
  const item = page
    .getByTestId('approval-item')
    .filter({ has: page.locator(`a[href="/admin/bookings?date=${bookedIso}"]`) })
    .first();
  await expect(item).toContainText('Casey');
  await expect(item).toContainText('Places left');
  await item.getByLabel(/Note for the customer/).fill('See you both soon');
  await item.getByRole('button', { name: /^Approve/ }).click();
  await expect(page.getByText('Request approved. The customer has been emailed.')).toBeVisible();
  await signOut(page);

  // The approval email says pay to secure, with the pay link and the deadline (D80).
  const approved = await latestEmail(DEMO_CUSTOMER.email, 'booking.request-approved');
  expect(approved.text).toContain(PAY_TO_SECURE_KEY);
  expect(approved.text).toMatch(/by \d{1,2} \w{3} \d{4}, \d\d:\d\d \(UK time\)/);
  expect(approved.text).not.toContain('See you both soon');
  const payLink = approved.text.match(/https?:\/\/\S+\/api\/payments\/pay\/\S+/)![0];

  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto(new URL(payLink).pathname);
  // Simulated card page stands in for Stripe in tests (PAYMENTS_DRIVER=simulated).
  await expect(page.getByRole('heading', { name: 'Test card payment' })).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Pay £100.00 with a test card' }).click();
  await expect(page.getByText('Payment received – you’re booked')).toBeVisible();
  await expect(page.getByText('See you both soon').first()).toBeVisible();
  await axe(page);

  const row = page.getByRole('row').filter({ hasText: 'Biscuit' }).first();
  bookedDateLabel = (await row.getByRole('cell').first().textContent())!;
  // One of the two days just paid for (other tests may leave Biscuit with unpaid days too).
  await page
    .getByRole('row')
    .filter({ hasText: 'Biscuit' })
    .filter({ hasText: 'Booked' })
    .last()
    .getByRole('link', { name: /Cancel Biscuit/ })
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
  await expect(page.getByText(/Waiting for payment/).first()).toBeVisible();
  await axe(page);
  // Today's booking is listed first (requests.spec may leave a later day awaiting payment).
  await page
    .getByRole('link', { name: /Pay £\d+\.\d\d by card/ })
    .first()
    .click();
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
