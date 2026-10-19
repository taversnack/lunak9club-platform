import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, signIn } from './helpers';

test('@a11y customer menu drawer: aria-expanded, Esc closes and returns focus, no axe violations', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account/);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
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

test.describe('@a11y 390px layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of [
    '/account/book',
    '/account/membership',
    '/account/dogs/new',
    '/account/contacts',
    '/account/data',
    '/account/profile',
  ]) {
    test(`@a11y focused controls on ${path} are never hidden under the fixed bars (WCAG 2.4.11)`, async ({ page }) => {
      await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
      await expect(page).toHaveURL(/\/account/);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const hidden: string[] = [];
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          // Anything fixed or sticky at the bottom (tab bar, sticky submit) that the control isn't part of.
          const all = [...document.querySelectorAll<HTMLElement>('[data-tabbar], [data-sticky-submit]')].filter(
            (b) => getComputedStyle(b).display !== 'none',
          );
          // Controls that live in one of the bars are always on top; nothing to check.
          if (all.some((b) => b.contains(el))) return null;
          const bars = all;
          const top = Math.min(window.innerHeight, ...bars.map((b) => b.getBoundingClientRect().top));
          const box = el.getBoundingClientRect();
          const name = el.getAttribute('aria-label') || el.getAttribute('name') || el.textContent || el.tagName;
          // Partly hidden counts too: any part of the control below the top of the bars.
          return { label: name.trim().slice(0, 40), covered: box.bottom > top + 1 && box.top < window.innerHeight };
        });
        if (r?.covered) hidden.push(r.label);
      }
      expect(hidden).toEqual([]);
    });
  }

  test('the bookings page has no sideways scroll', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await expect(page).toHaveURL(/\/account/);
    await page.goto('/account/bookings');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });
});

test.describe('menu drawer at 390px', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('locks the page behind it, and following a link focuses the new page, not Menu', async ({ page }) => {
    await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
    await expect(page).toHaveURL(/\/account/);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Your details' }).click();
    await expect(page).toHaveURL(/\/account\/profile/);
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
  });
});

test.describe('admin sidebar at 1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('a short admin page does not scroll vertically because of the sidebar', async ({ page }) => {
    await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/reviews');
    const nav = page.locator('[data-sidebar]');
    await expect(nav).toBeVisible();
    const m = await page.evaluate(() => {
      const side = document.querySelector('[data-sidebar]')!;
      const main = document.querySelector('main')!;
      return {
        scrollHeight: document.documentElement.scrollHeight,
        innerHeight: window.innerHeight,
        sideHeight: side.getBoundingClientRect().height,
        mainHeight: main.getBoundingClientRect().height,
      };
    });
    // The sidebar never sets the row height; it scrolls inside instead.
    expect(m.sideHeight).toBeLessThanOrEqual(Math.ceil(m.mainHeight));
    expect(m.sideHeight).toBeLessThanOrEqual(m.innerHeight);
    expect(m.scrollHeight, JSON.stringify(m)).toBeLessThanOrEqual(m.innerHeight);
  });
});
