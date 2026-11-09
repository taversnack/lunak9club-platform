import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, signIn } from './helpers';

/**
 * Every HTML page carries a Content-Security-Policy with a per-request nonce, and none of our own pages
 * trips it (a blocked script or style would show up as a violation event).
 */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);

async function visit(page: Page, path: string) {
  const res = await page.goto(path);
  expect(res?.status(), path).toBeLessThan(400);
  const csp = res?.headers()['content-security-policy'] ?? '';
  expect(csp, path).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp, path).toContain("frame-ancestors 'none'");
  // A different nonce each time.
  await page.waitForLoadState('networkidle');
  expect(await violations(page), path).toEqual([]);
  return csp;
}

test('public pages send a nonce policy and trip nothing', async ({ page }) => {
  await watchViolations(page);
  const a = await visit(page, '/sign-in');
  const b = await visit(page, '/register');
  await visit(page, '/forgot-password');
  expect(a.match(/nonce-([^']+)/)![1]).not.toBe(b.match(/nonce-([^']+)/)![1]);
  // Scripts still run: the sign-in form is interactive (React hydrated under the policy).
  await page.goto('/sign-in');
  await page.getByLabel('Email').first().fill('someone@example.test');
  await expect(page.getByLabel('Email').first()).toHaveValue('someone@example.test');
});

test('customer pages trip nothing', async ({ page }) => {
  await watchViolations(page);
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  for (const path of ['/account', '/account/book', '/account/bookings', '/account/invoices', '/account/membership'])
    await visit(page, path);
});

test('owner pages trip nothing', async ({ page }) => {
  await watchViolations(page);
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  for (const path of ['/admin', '/admin/bookings', '/admin/reviews', '/admin/invoices', '/admin/settings/business'])
    await visit(page, path);
});
