import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  DEMO_CUSTOMER,
  DEMO_CUSTOMER_2,
  DEMO_OWNER,
  latestEmail,
  setVaccinationExpiry,
  signIn,
  showDate,
  signOut,
} from './helpers';

test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** Request one dog on one day through the booking pages. */
async function request(page: Page, dog: string, iso: string) {
  await page.goto('/account/book');
  await page.getByRole('checkbox', { name: dog, exact: true }).check();
  await (await showDate(page, iso)).check();
  await page.getByRole('button', { name: 'Check price and availability' }).click();
  await expect(page.getByRole('heading', { name: 'Check your booking request' })).toBeVisible();
}

let dayIso = '';

test('Owner declines a request with a note: polite email, note in the portal only', async ({ page }, info) => {
  await signIn(page, DEMO_CUSTOMER_2.email, DEMO_CUSTOMER_2.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/account/book');
  // A Tuesday, Thursday or Friday nobody has booked yet (the membership tests use Mondays and Wednesdays).
  const free: string[] = [];
  for (const label of await page
    .locator('label')
    .filter({ has: page.locator('input[name="date"]:not([disabled])') })
    .all()) {
    const iso = (await label.locator('input').getAttribute('value'))!;
    const wd = new Date(`${iso}T12:00:00Z`).getUTCDay();
    if ([2, 4, 5].includes(wd) && !(await label.textContent())!.includes('Booked:')) free.push(iso);
  }
  dayIso = free[info.project.name === 'mobile' ? 8 : 11]!;
  await request(page, 'Rex', dayIso);
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.getByText('Booking request sent')).toBeVisible();
  await signOut(page);

  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Requests waiting' })).toBeVisible();
  await page.goto(`/admin/bookings?date=${dayIso}`);
  await expect(page.getByRole('heading', { name: /Requests waiting \(1\)/ })).toBeVisible();
  await axe(page);
  await page.goto('/admin/approvals');
  const item = page
    .getByTestId('approval-item')
    .filter({ has: page.locator(`a[href="/admin/bookings?date=${dayIso}"]`) })
    .first();
  await item.getByLabel(/Reason \(optional/).fill('We are short-staffed that day');
  await item.getByRole('button', { name: /^Decline/ }).click();
  await expect(page.getByText(/Request declined/)).toBeVisible();
  await signOut(page);

  const email = await latestEmail(DEMO_CUSTOMER_2.email, 'approval.rejected');
  expect(email.text).toContain('Unfortunately we can’t accept it this time');
  expect(email.text + email.html).not.toContain('short-staffed');

  await signIn(page, DEMO_CUSTOMER_2.email, DEMO_CUSTOMER_2.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/account/bookings');
  await expect(page.getByText('We are short-staffed that day').first()).toBeVisible();
  await expect(page.getByText('Not approved').first()).toBeVisible();
  await axe(page);
});

test('customer withdraws a waiting request from Your requests', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER_2.email, DEMO_CUSTOMER_2.password);
  await expect(page).toHaveURL(/\/account$/);
  await request(page, 'Rex', dayIso);
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.getByText('Booking request sent')).toBeVisible();
  await page.goto('/account/requests');
  await expect(page.getByRole('heading', { name: 'Waiting (1)' })).toBeVisible();
  await axe(page);
  await page
    .getByRole('link', { name: /^Withdraw/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Withdraw this request?' })).toBeVisible();
  await axe(page);
  await page.getByRole('button', { name: 'Yes, withdraw the request' }).click();
  await expect(page).toHaveURL(/\/account\/requests\?withdrawn=1/);
  await expect(page.getByText('Your request has been withdrawn')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Waiting (0)' })).toBeVisible();
  await expect(page.getByText('Withdrawn').first()).toBeVisible();
  await signOut(page);
});

test('Give place: a full day, the waitlist and the Owner choosing the dog', async ({ page }, info) => {
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/bookings?date=${dayIso}`);
  await page.getByLabel('Places per session').fill('1');
  await page.getByRole('button', { name: 'Update capacity' }).click();
  await expect(page.getByLabel('Places per session')).toHaveValue('1');
  await signOut(page);

  // Jordan's request takes the only place; Casey's goes on the waitlist.
  await signIn(page, DEMO_CUSTOMER_2.email, DEMO_CUSTOMER_2.password);
  await expect(page).toHaveURL(/\/account$/);
  await request(page, 'Rex', dayIso);
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.getByText('Booking request sent')).toBeVisible();
  await page
    .getByRole('button', { name: /^Withdraw request/ })
    .first()
    .click();
  await expect(page.getByText('Request withdrawn')).toBeVisible();
  await request(page, 'Rex', dayIso);
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page.getByText('Booking request sent')).toBeVisible();
  await signOut(page);

  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
  await request(page, 'Biscuit', dayIso);
  await expect(page.getByText('Full – waitlist')).toBeVisible();
  await page.getByRole('button', { name: 'Join the waitlist' }).click();
  await expect(page.getByText(/1 on the waitlist/)).toBeVisible();
  await signOut(page);

  // The Owner declines Jordan's day, then gives the place to Biscuit.
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/bookings?date=${dayIso}`);
  const req = page.getByRole('listitem').filter({ hasText: 'Requested' }).first();
  await req.getByText(/^Decline this day/).click();
  await req.getByLabel(/Reason for declining/).fill('Keeping numbers low');
  await req.getByRole('button', { name: /^Decline day/ }).click();
  await expect(page.getByRole('heading', { name: /Requests waiting \(0\)/ })).toBeVisible();
  // D82: a dog failing the vaccination check for the day can't be given the place – shown up front.
  const dayBefore = new Date(Date.parse(`${dayIso}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const was = await setVaccinationExpiry('Biscuit', 'vaccination_kennel_cough', dayBefore);
  expect(was).not.toBeNull();
  await page.reload();
  const give = page.getByRole('button', { name: 'Give place to Biscuit' });
  await expect(give).toBeDisabled();
  await expect(page.getByText(/Can’t give a place: .*runs out before this date/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Waitlist \(1\)/ })).toBeVisible();
  await setVaccinationExpiry('Biscuit', 'vaccination_kennel_cough', was!);
  await page.reload();
  await expect(give).toBeEnabled();
  await give.click();
  // Biscuit now has its own booking, held for payment with a pay link emailed (D82).
  await expect(page.getByRole('region', { name: /^Dogs/ })).toContainText('Biscuit');
  await expect(page.getByText(/Payment link sent – held until/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Waitlist \(0\)/ })).toBeVisible();
  await axe(page);
  await signOut(page);

  const link = await latestEmail(DEMO_CUSTOMER.email, 'payment.link');
  expect(link.text).toMatch(/\/api\/payments\/pay\//);
  void info;
});

test('a signed-out customer who opens the emailed pay link signs in and lands on the card payment', async ({
  page,
}) => {
  const link = await latestEmail(DEMO_CUSTOMER.email, 'payment.link');
  const href = /https?:\/\/[^\s"<>]+\/api\/payments\/pay\/[0-9a-f-]+/.exec(link.text)?.[0];
  expect(href).toBeTruthy();
  const payPath = new URL(href!).pathname;
  // Signed out: the pay link sends you to sign in, remembering where you were going.
  await page.goto(payPath);
  // Path and query only: the host is whatever APP_URL says, not necessarily the one the test used.
  await expect(page).toHaveURL((u) => u.pathname === '/sign-in' && u.searchParams.get('callbackUrl') === payPath);
  await page.getByLabel('Email address').fill(DEMO_CUSTOMER.email);
  await page.getByLabel('Password').fill(DEMO_CUSTOMER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // …and after signing in you're on the card payment, not the dashboard.
  await expect(page).toHaveURL(/\/dev\/checkout\//);
  await expect(page.getByRole('heading', { name: 'Test card payment' })).toBeVisible();
});

test('a sign-in link pointing at another site lands on the dashboard instead', async ({ page }) => {
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent('//evil.example/steal')}`);
  await page.getByLabel('Email address').fill(DEMO_CUSTOMER.email);
  await page.getByLabel('Password').fill(DEMO_CUSTOMER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account$/); // /dashboard sends a customer to /account
});
