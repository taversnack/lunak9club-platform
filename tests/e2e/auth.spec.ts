import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, latestLink, signIn, signOut, uniqueEmail } from './helpers';

test('customer registers, confirms email and reaches their account', async ({ page }, info) => {
  const email = uniqueEmail('new', info.project.name);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Riley Tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('riley-long-password');
  await page.getByLabel('Confirm password').fill('riley-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Signing in before confirming is refused with a clear message.
  await signIn(page, email, 'riley-long-password');
  await expect(page.getByText('Please confirm your email')).toBeVisible();

  await page.goto(await latestLink(email, 'auth.verify-email'));
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Hello, Riley' })).toBeVisible();

  // No dogs yet: Book says to add one first, not that a dog needs approving.
  await page.goto('/account/book');
  await expect(page.getByText('Add your dog to start booking')).toBeVisible();
  await expect(page.getByText('needs to be approved')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Add your dog' }).getByRole('link', { name: 'Add a dog' }),
  ).toHaveAttribute('href', '/account/dogs/new');
});

test('registration form explains errors next to each field', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Error: Enter your full name')).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Error: Use at least 10 characters')).toBeVisible();
});

test('customers cannot open the owner area', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/access-denied$/);
  await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();
});

test('anonymous visitors are sent to sign in', async ({ page }) => {
  for (const path of ['/admin', '/account', '/dashboard']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in$/);
  }
});

test('owner signs in to the owner dashboard and sees recent activity', async ({ page }) => {
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Owner dashboard' })).toBeVisible();
  // Plain-English activity, not raw event codes.
  await expect(page.getByRole('table')).toContainText('Signed in');
  await expect(page.getByRole('table')).not.toContainText('auth.signed_in');
  await signOut(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('wrong password shows a generic error', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, 'definitely-wrong');
  await expect(page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' })).toBeVisible();
});

test('customer resets a forgotten password', async ({ page }, info) => {
  const email = uniqueEmail('reset', info.project.name);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Sam Reset');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('sam-first-password');
  await page.getByLabel('Confirm password').fill('sam-first-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.goto(await latestLink(email, 'auth.verify-email'));
  await expect(page).toHaveURL(/\/account$/);
  await signOut(page);

  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await page.goto(await latestLink(email, 'auth.reset-password'));
  await page.getByLabel('New password', { exact: true }).fill('sam-second-password');
  await page.getByLabel('Confirm new password').fill('sam-second-password');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Password updated')).toBeVisible();
  await signIn(page, email, 'sam-second-password');
  await expect(page).toHaveURL(/\/account$/);
});

test('signing in from a link before confirming: the confirmation email brings you back to that link', async ({
  page,
}, info) => {
  const email = uniqueEmail('callback', info.project.name);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Robin Callback');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('robin-long-password');
  await page.getByLabel('Confirm password').fill('robin-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent('/account/bookings')}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('robin-long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Please confirm your email')).toBeVisible();

  // The new confirmation email (sent on that sign-in) carries the way back.
  let link = '';
  await expect
    .poll(async () => (link = await latestLink(email, 'auth.verify-email')), { timeout: 10_000 })
    .toContain(`callbackURL=${encodeURIComponent('/account/bookings')}`);
  await page.goto(link);
  await expect(page).toHaveURL(/\/account\/bookings$/);
});
