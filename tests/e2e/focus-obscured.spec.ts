import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, signIn } from './helpers';

/**
 * WCAG 2.4.11 Focus Not Obscured: on long AppShell pages, tab forwards past the fold, then Shift+Tab
 * back. Every focused control must sit below the sticky header and above any fixed bottom bar
 * (tab bar, sticky submit), at 390 and 1280.
 */
const PAGES: { path: string; who: 'customer' | 'owner' }[] = [{ path: '/account/book', who: 'customer' }];

async function check(page: Page, key: 'Tab' | 'Shift+Tab') {
  await page.keyboard.press(key);
  // Let the browser finish scrolling the control into view.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const header = document.querySelector<HTMLElement>('[data-app-header]');
    const bars = [...document.querySelectorAll<HTMLElement>('[data-tabbar], [data-sticky-submit]')].filter(
      (b) => getComputedStyle(b).display !== 'none',
    );
    // Controls inside the bars themselves are always on top.
    if (header?.contains(el) || bars.some((b) => b.contains(el))) return null;
    // Fixed or absolute overlays (the skip link sits above the header on purpose) aren't scrolled into view.
    const pos = getComputedStyle(el).position;
    if (pos === 'fixed' || pos === 'absolute') return null;
    const box = el.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return null;
    const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
    const barsTop = Math.min(window.innerHeight, ...bars.map((b) => b.getBoundingClientRect().top));
    const label = (el.getAttribute('aria-label') || el.getAttribute('name') || el.textContent || el.tagName)
      .trim()
      .slice(0, 40);
    // A control taller than the space between the bars (a scrollable table region) can't fit; 2.4.11
    // then only needs part of it visible. Everything else must be wholly clear of the bars.
    if (box.height > barsTop - headerBottom) {
      const hidden = box.bottom <= headerBottom + 1 || box.top >= barsTop - 1;
      return { label, under: hidden, over: hidden, y: window.scrollY };
    }
    return { label, under: box.top < headerBottom - 1, over: box.bottom > barsTop + 1, y: window.scrollY };
  });
}

for (const vp of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`@a11y focus not obscured at ${vp.width}px`, () => {
    test.use({ viewport: vp });
    for (const { path, who } of PAGES) {
      test(`Tab and Shift+Tab on ${path} never put focus under the sticky header or bottom bars`, async ({ page }) => {
        test.setTimeout(180_000);
        const u = who === 'owner' ? DEMO_OWNER : DEMO_CUSTOMER;
        await signIn(page, u.email, u.password);
        await expect(page).not.toHaveURL(/\/sign-in/);
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        const bad: string[] = [];
        let maxY = 0;
        // Sweep the whole page: Tab until focus leaves the document (or 300 steps), then all the way back.
        let steps = 0;
        for (; steps < 300; steps++) {
          const r = await check(page, 'Tab');
          if (steps > 5 && (await page.evaluate(() => document.activeElement === document.body))) break;
          if (r) maxY = Math.max(maxY, r.y);
          if (r?.under) bad.push(`Tab under header: ${r.label}`);
          if (r?.over) bad.push(`Tab under bottom bar: ${r.label}`);
        }
        // The page must be long enough that we really went past the fold.
        if (path === '/account/book') expect(maxY, 'tabbing forwards scrolled the page').toBeGreaterThan(0);
        for (let i = 0; i < steps; i++) {
          const r = await check(page, 'Shift+Tab');
          if (r?.under) bad.push(`Shift+Tab under header: ${r.label}`);
          if (r?.over) bad.push(`Shift+Tab under bottom bar: ${r.label}`);
        }
        expect(bad).toEqual([]);
      });
    }
  });
}
