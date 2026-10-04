import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_CUSTOMER_2, DEMO_OWNER, signIn, signOut } from './helpers';

test.describe.configure({ mode: 'serial' });

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const who = (project: string) =>
  project === 'mobile'
    ? { user: DEMO_CUSTOMER_2, dog: 'Rex', label: 'Rex (Jordan Second)' }
    : { user: DEMO_CUSTOMER, dog: 'Biscuit', label: 'Biscuit (Casey Customer)' };

let incidentId = '';
let dogId = '';

test('Owner reports an incident and records a daily check that must be shared', async ({ page }, info) => {
  const { dog, label } = who(info.project.name);
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('navigation', { name: 'Owner' }).getByRole('link', { name: 'Incidents' }).click();
  await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible();
  await axe(page);
  await page.getByRole('link', { name: 'Report an incident' }).click();
  await axe(page);
  await page.getByLabel('Dog', { exact: true }).selectOption({ label });
  await page.getByLabel('Time (24-hour)').fill('00:01');
  await page.getByRole('radio', { name: 'Injury' }).check();
  await page.getByRole('radio', { name: 'Minor' }).check();
  await page.getByLabel('What happened (the customer sees this)').fill('Small graze on a paw during play.');
  await page.getByLabel('What we did (the customer sees this)').fill('Cleaned it and kept an eye on it.');
  await page.getByLabel('Internal notes (only you see these)').fill('Busy play group – split next time.');
  await page.getByRole('button', { name: 'Save and tell the customer' }).click();
  await expect(page.getByText('Incident saved. The customer has been emailed.')).toBeVisible();
  incidentId = page.url().match(/incidents\/([0-9a-f-]{36})/)![1]!;
  await axe(page);

  await page.getByRole('link', { name: dog, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dogs\/[0-9a-f-]{36}$/);
  dogId = page.url().match(/dogs\/([0-9a-f-]{36})/)![1]!;
  await page.getByRole('link', { name: 'Daily check' }).click();
  await expect(page.getByRole('heading', { name: `Daily check – ${dog}` })).toBeVisible();
  await axe(page);
  await page.getByRole('radio', { name: 'Ate everything' }).check();
  await page.getByRole('radio', { name: 'Drinking less than usual' }).check();
  await page.getByRole('radio', { name: 'Happy' }).check();
  await page.getByRole('textbox', { name: 'Note (optional)' }).fill('Left some water in the bowl all day.');
  await page.getByRole('button', { name: 'Save check' }).click();
  await expect(page.getByText(/it’s been shared and they’ve been emailed/)).toBeVisible();
  await page.goto('/admin/data-requests');
  await axe(page);
  await signOut(page);
});

test('the customer reads the report (but not internal notes), acknowledges it and sees the note', async ({
  page,
}, info) => {
  const { user, dog } = who(info.project.name);
  await signIn(page, user.email, user.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto(`/account/dogs/${dogId}`);
  await expect(page.getByText(`Please read: incident report for ${dog}`)).toBeVisible();
  const notes = page.getByRole('region', { name: 'From day care' });
  await expect(notes).toContainText('Drinking less than usual');
  await expect(notes).toContainText('Left some water in the bowl all day.');
  await axe(page);
  await page.goto(`/account/incidents/${incidentId}`);
  await expect(page.getByText('Small graze on a paw during play.')).toBeVisible();
  await expect(page.getByText(/split next time/)).toHaveCount(0);
  await axe(page);
  await page.getByRole('button', { name: 'I’ve read this' }).click();
  await expect(page.getByText(/You confirmed you’d read this/)).toBeVisible();

  await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Your data' }).click();
  await expect(page.getByRole('heading', { name: 'Your data', level: 1 })).toBeVisible();
  await axe(page);
  const exp = await page.request.get('/api/account/export');
  expect(exp.status()).toBe(200);
  const json = (await exp.json()) as { dogs: { name: string }[]; incidentReports: unknown[] };
  expect(json.dogs.map((d) => d.name)).toContain(dog);
  expect(JSON.stringify(json)).not.toContain('split next time');
  // Customers can't reach the Owner's incident pages.
  await page.goto(`/admin/incidents/${incidentId}`);
  await expect(page).toHaveURL(/\/access-denied$/);
});
