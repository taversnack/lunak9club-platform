import { expect, test, type Page } from '@playwright/test';
import { DEMO_CUSTOMER, DEMO_OWNER, latestLink, signIn, signOut, uniqueEmail } from './helpers';

test('customer registers, confirms email and reaches their account', async ({ page }, info) => {
  const email = uniqueEmail('new', info.project.name);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Riley Tester');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('riley-long-password');
  await page.getByLabel('Confirm password').fill('riley-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // Signing in before confirming is refused with a clear message.
  await signIn(page, email, 'riley-long-password');
  await expect(page.getByText('Please confirm your email')).toBeVisible();

  await page.goto(await latestLink(email, 'auth.verify-email'));
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Hello, Riley' })).toBeVisible();

  // No dogs yet: Book says to add one first, not that a dog needs approving.
  await page.goto('/account/book');
  await expect(page.getByText('Add your dog to start booking')).toBeVisible();
  await expect(page.getByText('needs to be approved')).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Add your dog' }).getByRole('link', { name: 'Add a dog' }),
  ).toHaveAttribute('href', '/account/dogs/new');
});

test('registration form explains errors next to each field', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Error: Enter your full name')).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Error: Use at least 10 characters')).toBeVisible();
});

test('customers cannot open the owner area', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/access-denied$/);
  await expect(page.getByRole('heading', { name: 'You don’t have access to this page' })).toBeVisible();
});

test('anonymous visitors are sent to sign in, remembering the page they asked for', async ({ page }) => {
  for (const path of ['/admin', '/account']) {
    await page.goto(path);
    await expect(page).toHaveURL(`/sign-in?callbackUrl=${encodeURIComponent(path)}`);
  }
  await page.goto('/dashboard'); // the default after sign-in anyway
  await expect(page).toHaveURL(/\/sign-in$/);
});

async function signInHere(page: Page, email: string, password: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a signed-out customer deep-linking to an account page lands back on it after sign-in', async ({ page }) => {
  const target = '/account/bookings?payment=expired';
  await page.goto(target);
  await expect(page).toHaveURL(`/sign-in?callbackUrl=${encodeURIComponent(target)}`);
  await signInHere(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(target);
  await expect(page.getByText('That payment link has ended')).toBeVisible();
});

test('a signed-out Owner deep-linking to an admin page lands back on it after sign-in', async ({ page }) => {
  const target = '/admin/customers?q=casey';
  await page.goto(target);
  await expect(page).toHaveURL(`/sign-in?callbackUrl=${encodeURIComponent(target)}`);
  await signInHere(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(target);
  // The Owner nav is in the sidebar on desktop and inside the closed Menu drawer at 390px, so check the page.
  await expect(page.getByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();
  await expect(page.locator('#q')).toHaveValue('casey'); // the query came back too
});

test('a customer who follows an admin link and signs in gets no-access, not a sign-in loop', async ({ page }) => {
  await page.goto('/admin/customers');
  await signInHere(page, DEMO_CUSTOMER.email, DEMO_CUSTOMER.password);
  await expect(page).toHaveURL(/\/access-denied$/);
  await expect(page.getByRole('heading', { name: /You don.t have access to this page/ })).toBeVisible();
  // Signed in now, so /admin goes straight to no-access, never back to sign-in.
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/access-denied$/);
});

test('a return-to header sent by the client is ignored, even on paths that look like files', async ({ page }) => {
  // The proxy sets this header for the guards; a value the browser sends must never be used.
  await page.context().setExtraHTTPHeaders({ 'x-lunak9-return-to': '/admin/settings' });
  for (const path of ['/account/dogs/x.json', '/admin/customers/x.json', '/account/bookings']) {
    await page.goto(path);
    await expect(page).toHaveURL((u) => u.pathname === '/sign-in' && u.searchParams.get('callbackUrl') === path);
  }
});

test('owner signs in to the owner dashboard and sees recent activity', async ({ page }) => {
  await signIn(page, DEMO_OWNER.email, DEMO_OWNER.password);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Owner dashboard' })).toBeVisible();
  // Plain-English activity, not raw event codes.
  await expect(page.getByRole('table')).toContainText('Signed in');
  await expect(page.getByRole('table')).not.toContainText('auth.signed_in');
  await signOut(page);
  await page.goto('/admin');
  await expect(page).toHaveURL(`/sign-in?callbackUrl=${encodeURIComponent('/admin')}`);
});

test('wrong password shows a generic error', async ({ page }) => {
  await signIn(page, DEMO_CUSTOMER.email, 'definitely-wrong');
  await expect(page.getByRole('alert').filter({ hasText: 'Email or password is incorrect.' })).toBeVisible();
});

test('customer resets a forgotten password', async ({ page }, info) => {
  const email = uniqueEmail('reset', info.project.name);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Sam Reset');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('sam-first-password');
  await page.getByLabel('Confirm password').fill('sam-first-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.goto(await latestLink(email, 'auth.verify-email'));
  await expect(page).toHaveURL(/\/account$/);
  await signOut(page);

  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('Check your email')).toBeVisible();
  await page.goto(await latestLink(email, 'auth.reset-password'));
  await page.getByLabel('New password', { exact: true }).fill('sam-second-password');
  await page.getByLabel('Confirm new password').fill('sam-second-password');
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByText('Password updated')).toBeVisible();
  await signIn(page, email, 'sam-second-password');
  await expect(page).toHaveURL(/\/account$/);
});

test('signing in from a link before confirming: the confirmation email brings you back to that link', async ({
  page,
}, info) => {
  const email = uniqueEmail('callback', info.project.name);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Robin Callback');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('robin-long-password');
  await page.getByLabel('Confirm password').fill('robin-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent('/account/bookings')}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill('robin-long-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Please confirm your email')).toBeVisible();

  // The new confirmation email (sent on that sign-in) carries the way back.
  let link = '';
  await expect
    .poll(async () => (link = await latestLink(email, 'auth.verify-email')), { timeout: 10_000 })
    .toContain(`callbackURL=${encodeURIComponent('/account/bookings')}`);
  await page.goto(link);
  await expect(page).toHaveURL(/\/account\/bookings$/);
});

test('magic link: a customer signs in from the emailed link once and lands on the callback page', async ({
  page,
}, info) => {
  // Each project (mobile, desktop) uses its own new, confirmed customer, so the two runs never share
  // an inbox or a token.
  const email = uniqueEmail('magic', info.project.name);
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Mags Link');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('mags-long-password');
  await page.getByLabel('Confirm password').fill('mags-long-password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await latestLink(email, 'auth.verify-email'));
  await expect(page).toHaveURL(/\/account$/);
  await page.context().clearCookies();

  await page.goto('/');
  // No sign-in UI for this yet (Dev4); ask for the link the way the client helper does.
  const status = await page.evaluate(async (email) => {
    const r = await fetch('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: '/account/bookings' }),
    });
    return r.status;
  }, email);
  expect(status).toBe(200);
  const link = await latestLink(email, 'auth.magic-link');
  expect(link).toContain('/api/auth/magic-link/verify?token=');
  await page.goto(link);
  await expect(page).toHaveURL(/\/account\/bookings$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The same link a second time doesn't sign anyone in: back to sign-in, keeping the way back.
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Faccount%2Fbookings&error=INVALID_TOKEN$/);
});
