import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, showDate, signIn } from './helpers';

/**
 * WCAG 1.4.10 Reflow: at 320 CSS px nothing may scroll sideways, also with the WCAG 1.4.12 text-spacing
 * overrides applied. The AppShell header and the booking date cards are the usual culprits, so the
 * customer gets an upcoming booking request first. Header tap targets must be at least 44px high.
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

/** The WCAG 1.4.12 text-spacing overrides. */
const TEXT_SPACING = `*, *::before, *::after {
  line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important;
}
p { margin-bottom: 2em !important; }`;

async function widths(page: Page, paths: string[]) {
  const wide: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const plain = await page.evaluate(() => document.documentElement.scrollWidth);
    if (plain > 320) wide.push(`${path}: ${plain}px`);
    await page.addStyleTag({ content: TEXT_SPACING });
    const spaced = await page.evaluate(() => document.documentElement.scrollWidth);
    if (spaced > 320) wide.push(`${path} (text spacing): ${spaced}px`);
  }
  return wide;
}

async function headerTargets(page: Page) {
  const small: string[] = [];
  for (const el of await page
    .locator('header a[class*="ctaPill"], header button[aria-haspopup], header button[class*="menuButton"]')
    .all()) {
    if (!(await el.isVisible())) continue;
    const box = (await el.boundingBox())!;
    const name = (await el.getAttribute('aria-label')) ?? (await el.innerText());
    if (box.height < 44) small.push(`${name}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    if (/menu/i.test(name) && box.width < 44) small.push(`${name}: ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
  return small;
}

test.describe('@a11y reflow at 320px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('customer pages with an upcoming booking: no sideways scroll, plain or with text spacing', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'viewport set by this spec');
    test.setTimeout(90_000);
    await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await expect(page).toHaveURL(/\/account/);
    // An upcoming booking request, so /account and the lists show date cards.
    await page.goto('/account/book');
    await page.getByRole('checkbox', { name: 'Biscuit', exact: true }).check();
    // The calendar shows two weeks at a time, so page forward to the day first.
    const iso = (await page.locator('input[name="date"]:not([disabled])').nth(12).getAttribute('value'))!;
    await (await showDate(page, iso)).check();
    await page.getByRole('button', { name: 'Check price and availability' }).click();
    await page.getByRole('button', { name: 'Send booking request' }).click();
    await expect(page.getByText('Booking request sent')).toBeVisible();
    await page.goto('/account');
    await expect(page.locator('[aria-labelledby="next-booking"] li').first()).toBeVisible();

    expect(await widths(page, ACCOUNT)).toEqual([]);
    await page.goto('/account');
    expect(await headerTargets(page)).toEqual([]);
    await expect(page.locator('header').getByRole('link', { name: 'Book a day', exact: true })).toBeVisible();
  });

  test('owner pages, including a dog page: no sideways scroll, plain or with text spacing', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'viewport set by this spec');
    test.setTimeout(90_000);
    await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
    await expect(page).toHaveURL(/\/admin/);
    // A real dog page: the demo customer's first dog, reached from their customer page.
    await page.goto('/admin/customers?q=casey');
    await page.locator('main a[href^="/admin/customers/"]:not([href$="/new"])').first().click();
    await expect(page).toHaveURL(/\/admin\/customers\/[^/?]+$/);
    const dogHref = await page.locator('main a[href^="/admin/dogs/"]').first().getAttribute('href');
    expect(dogHref).toBeTruthy();

    expect(await widths(page, [...ADMIN, dogHref!])).toEqual([]);
    await page.goto('/admin');
    expect(await headerTargets(page)).toEqual([]);
    await expect(page.locator('header').getByRole('link', { name: 'Today’s bookings', exact: true })).toBeVisible();
  });
});

test.describe('@a11y header tap targets', () => {
  for (const width of [390, 1280]) {
    test(`header CTA and menu button are at least 44px high at ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name !== 'mobile', 'viewport set by this spec');
      await page.setViewportSize({ width, height: 800 });
      await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
      await expect(page).toHaveURL(/\/admin/);
      expect(await headerTargets(page)).toEqual([]);
    });
  }
});
