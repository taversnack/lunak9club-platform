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
  await expect(page.getByRole('table')).toContainText('auth.signed_in');
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
