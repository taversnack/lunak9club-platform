import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, signIn } from './helpers';

/**
 * WCAG 1.4.10 Reflow: at 320 CSS px nothing may scroll sideways or be clipped, also with the WCAG 1.4.12
 * text-spacing overrides applied. The AppShell header and the booking date cards are the usual culprits,
 * so the customer gets an upcoming booking request first. Header tap targets must be at least 44px high.
 */
const ACCOUNT = [
  '/account',
  '/account/book',
  '/account/bookings',
  '/account/requests',
  '/account/invoices',
  '/account/membership',
  '/account/profile',
  '/account/contacts',
  '/account/faq',
  '/account/data',
];

/** The WCAG 1.4.12 text-spacing overrides. */
const TEXT_SPACING = `*, *::before, *::after {
  line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important;
}
p { margin-bottom: 2em !important; }`;

/** Anything inside <main> or the header whose right edge is past the viewport, or whose text is cut off. */
async function overflowing(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const width = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth > width) out.push(`page ${document.documentElement.scrollWidth}px`);
    for (const el of document.querySelectorAll<HTMLElement>('header *, main *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      // Visually hidden text and anything inside its own scroll region (data tables) are fine.
      if (el.clientWidth <= 1 || el.closest('.visually-hidden')) continue;
      let scroller = el.parentElement;
      while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX))
        scroller = scroller.parentElement;
      if (scroller && scroller !== document.documentElement && scroller !== document.body) continue;
      const label = `${el.tagName.toLowerCase()} "${(el.innerText || '').trim().slice(0, 30)}"`;
      if (r.right > width + 0.5) out.push(`${label} ends at ${Math.round(r.right)}px`);
      const cs = getComputedStyle(el);
      if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && el.children.length === 0)
        out.push(`${label} clipped (${el.scrollWidth} > ${el.clientWidth})`);
    }
    return out.slice(0, 5);
  });
}

async function widths(page: Page, paths: string[], before?: (page: Page) => Promise<void>) {
  const wide: string[] = [];
  for (const path of paths) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (before) await before(page);
    for (const o of await overflowing(page)) wide.push(`${path}: ${o}`);
    await page.addStyleTag({ content: TEXT_SPACING });
    for (const o of await overflowing(page)) wide.push(`${path} (text spacing): ${o}`);
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

/** A long, unbroken dog name in every date card, as some customers have (the Tester's case). */
async function longDogName(page: Page) {
  await page.evaluate(() => {
    for (const h of document.querySelectorAll('main li h3'))
      h.textContent = 'Sir Barkington-Featherstonehaugh the Third of Little Snoring on the Marsh · Full day';
  });
}

test.describe('@a11y reflow at 320px', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('customer pages with an upcoming booking: no sideways scroll or clipping, plain or with text spacing', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'mobile', 'viewport set by this spec');
    test.setTimeout(120_000);
    await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await expect(page).toHaveURL(/\/account/);
    // An upcoming booking request, so /account and the lists show date cards.
    await page.goto('/account/book');
    await page.getByRole('checkbox', { name: 'Biscuit', exact: true }).check();
    await page.locator('input[name="date"]:not([disabled])').nth(12).check();
    await page.getByRole('button', { name: 'Check price and availability' }).click();
    await page.getByRole('button', { name: 'Send booking request' }).click();
    await expect(page.getByText('Booking request sent')).toBeVisible();
    await page.goto('/account');
    await expect(page.locator('[aria-labelledby="next-booking"] li').first()).toBeVisible();

    expect(await widths(page, ACCOUNT)).toEqual([]);
    expect(await widths(page, ['/account', '/account/bookings', '/account/requests'], longDogName)).toEqual([]);
    await page.goto('/account');
    expect(await headerTargets(page)).toEqual([]);
    await expect(page.locator('header').getByRole('link', { name: 'Book a day', exact: true })).toBeVisible();
  });
});

test.describe('@a11y header tap targets', () => {
  for (const width of [390, 1280]) {
    test(`header CTA and menu button are at least 44px high at ${width}px`, async ({ page }, info) => {
      test.skip(info.project.name !== 'mobile', 'viewport set by this spec');
      await page.setViewportSize({ width, height: 800 });
      await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
      await expect(page).toHaveURL(/\/account/);
      expect(await headerTargets(page)).toEqual([]);
    });
  }
});
