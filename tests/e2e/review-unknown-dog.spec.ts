import { expect, test } from '@playwright/test';
import { DEMO_CUSTOMER, signIn } from './helpers';

test('the booking review page for a dog that is not yours or does not exist is a 404, not a crash', async ({
  page,
}) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
  for (const dog of ['not-a-dog-id', '00000000-0000-4000-8000-000000000000']) {
    const r = await page.goto(`/account/book/review?dog=${dog}&session=full&date=2030-01-07`);
    expect(r?.status(), dog).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  }
});
