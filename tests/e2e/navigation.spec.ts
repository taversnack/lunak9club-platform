import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, signIn } from './helpers';

test('@a11y customer menu drawer: aria-expanded, Esc closes and returns focus, no axe violations', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account/);
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
  await expect(
    page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Your details' }),
  ).toBeVisible();
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
});

test('customer header always shows the Book a day pill', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByRole('link', { name: 'Book a day' }).first()).toBeVisible();
});
