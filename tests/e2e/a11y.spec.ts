import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, signIn } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: import('@playwright/test').Page) {
  // Title is streamed with metadata; wait for it so axe doesn't race it (document-title).
  await expect(page).toHaveTitle(/\S/);
  const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
}

test.describe('@a11y WCAG 2.2 AA automated checks', () => {
  for (const path of ['/', '/sign-in', '/register', '/forgot-password', '/verify-email', '/access-denied']) {
    test(`public page ${path}`, async ({ page }) => {
      await page.goto(path);
      await scan(page);
    });
  }

  test('sign-in: link sent state', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill('nobody@example.com');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused();
    await scan(page);
  });

  test('sign-in: expired or used link', async ({ page }) => {
    await page.goto('/sign-in?callbackUrl=%2Faccount&error=INVALID_TOKEN');
    await expect(page.getByRole('main').getByRole('alert')).toBeVisible();
    await scan(page);
  });

  test('sign-in: email field error and password form', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await expect(page.getByText('Error: Enter an email address')).toBeVisible();
    await scan(page);
    await page.getByRole('button', { name: 'Sign in with a password instead' }).click();
    await expect(page.getByLabel('Password')).toBeVisible();
    await scan(page);
  });

  test('register with validation errors shown', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    await scan(page);
  });

  test('customer account', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await expect(page).toHaveURL(/\/account$/);
    await scan(page);
  });

  test('owner dashboard', async ({ page }) => {
    await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
    await expect(page).toHaveURL(/\/admin$/);
    await scan(page);
  });

  test('customer account pages', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await expect(page).toHaveURL(/\/account$/);
    for (const path of [
      '/account/profile',
      '/account/contacts',
      '/account/terms',
      '/account/dogs/new',
      '/account/invoices',
      '/account/membership',
      '/account/faq',
      '/account/book',
      '/account/bookings',
      '/account/requests',
    ]) {
      await page.goto(path);
      await scan(page);
    }
  });

  test('payment notices take focus; the permanent booking notice is not a live region', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await expect(page).toHaveURL(/\/account$/);
    for (const [payment, title] of [
      ['expired', 'That payment link has ended'],
      ['unavailable', 'We couldn’t create your payment link'],
    ] as const) {
      await page.goto(`/account/bookings?payment=${payment}`);
      const notice = page.getByTestId('payment-notice');
      await expect(notice).toContainText(title);
      await expect(notice).toHaveAttribute('tabindex', '-1');
      await expect(notice).toBeFocused();
      await scan(page);
    }
    await page.goto('/account/bookings');
    await expect(page.getByTestId('payment-notice')).toHaveCount(0);

    await page.goto('/account/book');
    const how = page
      .getByTestId('book-request-not-secured')
      .locator('xpath=ancestor::*[.//*[normalize-space()="How booking works"]][1]');
    await expect(how).toBeVisible();
    await expect(how).not.toHaveAttribute('role', /.+/);
    await expect(how).not.toHaveAttribute('aria-live', /.+/);
    await expect(
      page.locator('[role=status], [role=alert], [aria-live]').filter({ hasText: 'How booking works' }),
    ).toHaveCount(0);
  });

  test('owner pages', async ({ page }) => {
    await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
    await expect(page).toHaveURL(/\/admin$/);
    for (const path of [
      '/admin/reviews',
      '/admin/customers',
      '/admin/customers/new',
      '/admin/memberships',
      '/admin/approvals',
      '/admin/settings/requirements',
      '/admin/settings/terms',
      '/admin/invoices',
      '/admin/refunds',
      '/admin/settings/business',
      '/admin/approvals',
      '/admin/bookings',
      '/admin/settings/availability',
    ]) {
      await page.goto(path);
      await scan(page);
    }
  });

  test('finish-signup with a bad link', async ({ page }) => {
    await page.goto('/finish-signup?token=not-a-real-token-value');
    await scan(page);
  });

  test('skip link moves focus to main content', async ({ page }) => {
    await page.goto('/sign-in');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});
