import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, signIn } from './helpers';

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function scan(page: import('@playwright/test').Page) {
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
    ]) {
      await page.goto(path);
      await scan(page);
    }
  });

  test('owner pages', async ({ page }) => {
    await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
    await expect(page).toHaveURL(/\/admin$/);
    for (const path of [
      '/admin/reviews',
      '/admin/customers',
      '/admin/settings/requirements',
      '/admin/settings/terms',
      '/admin/invoices',
      '/admin/refunds',
      '/admin/settings/business',
    ]) {
      await page.goto(path);
      await scan(page);
    }
  });

  test('skip link moves focus to main content', async ({ page }) => {
    await page.goto('/sign-in');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});
