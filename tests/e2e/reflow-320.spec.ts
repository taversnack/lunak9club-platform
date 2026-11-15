import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, signIn } from './helpers';

// WCAG 1.4.10: at 320 px wide nothing may need sideways scrolling, including the header.
const overflow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('customer pages do not scroll sideways at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
  for (const path of ['/account', '/account/book', '/account/bookings', '/account/dogs', '/account/membership']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await overflow(page), path).toBeLessThanOrEqual(0);
  }
});

test('Owner pages do not scroll sideways at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  for (const path of ['/admin', '/admin/bookings', '/admin/invoices']) {
    await page.goto(path);
    expect(await overflow(page), path).toBeLessThanOrEqual(0);
  }
});
