import { expect, test } from '@playwright/test';
import { DEMO_OWNER, signIn } from './helpers';

test.describe('owner pages fit a 390px phone (no sideways scroll)', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // in the mobile project this keeps Pixel 7's phone zoom-out behaviour

  test('/admin/settings/pricing: the price lists table scrolls inside its own box', async ({ page }) => {
    await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/settings/pricing');
    await expect(page.getByRole('heading', { name: 'Prices', level: 1 })).toBeVisible();
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      // For a useful failure message: the widest elements that stick out.
      wide: [...document.querySelectorAll('body *')]
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter((x) => x.r.right > window.innerWidth + 1)
        .slice(0, 5)
        .map(
          (x) => `${x.e.tagName.toLowerCase()}.${String(x.e.className).slice(0, 40)} right=${Math.round(x.r.right)}`,
        ),
    }));
    expect(m.scrollWidth, m.wide.join('\n')).toBeLessThanOrEqual(m.innerWidth);
    // The table itself is still all there: the wrapper scrolls instead of the page.
    const wrap = page.locator('[role="region"][aria-label="Price lists"]');
    expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  });
});
