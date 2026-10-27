import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, signIn } from './helpers';

/**
 * WCAG 1.4.10 Reflow: at 320 CSS px nothing may scroll sideways. The AppShell header (logo, call to
 * action, menu) is the usual culprit, so sample admin and account pages.
 */
const ADMIN = [
  '/admin',
  '/admin/bookings',
  '/admin/settings/availability',
  '/admin/reviews',
  '/admin/approvals',
  '/admin/customers',
];
const ACCOUNT = [
  '/account',
  '/account/book',
  '/account/bookings',
  '/account/requests',
  '/account/invoices',
  '/account/profile',
];

test.describe('@a11y reflow at 320px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const [who, paths] of [
    ['owner', ADMIN],
    ['customer', ACCOUNT],
  ] as const) {
    test(`${who} pages have no sideways scroll and the header CTA keeps its name`, async ({ page }, info) => {
      // The viewport is fixed here, so one project is enough.
      test.skip(info.project.name !== 'mobile', 'viewport set by this spec');
      const u = who === 'owner' ? DEMO_OWNER : DEMO_CUSTOMER;
      await signIn(page, u.email, u.password);
      await expect(page).not.toHaveURL(/\/sign-in/);
      const wide: string[] = [];
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const w = await page.evaluate(() => document.documentElement.scrollWidth);
        if (w > 320) wide.push(`${path}: ${w}px`);
      }
      expect(wide).toEqual([]);
      const name = who === 'owner' ? 'Today’s bookings' : 'Book a day';
      await expect(page.locator('header').getByRole('link', { name, exact: true })).toBeVisible();
    });
  }
});
