import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, signIn } from './helpers';

const MISSING = '/no-such-page-for-the-404-test';

test('a signed-out visitor on the 404 page is offered sign-in and home, not account links', async ({ page }) => {
  const r = await page.goto(MISSING);
  expect(r?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute('href', '/sign-in');
  await expect(main.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/');
  await expect(main.getByRole('link', { name: 'Go to your dashboard' })).toHaveCount(0);
  await expect(main.getByRole('link', { name: 'Book day care' })).toHaveCount(0);
});

test('a signed-in customer on the 404 page keeps the dashboard and booking links', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  const r = await page.goto(MISSING);
  expect(r?.status()).toBe(404);
  const main = page.locator('main');
  await expect(main.getByRole('link', { name: 'Go to your dashboard' })).toHaveAttribute('href', '/dashboard');
  await expect(main.getByRole('link', { name: 'Book day care' })).toHaveAttribute('href', '/account/book');
  await expect(main.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
});
