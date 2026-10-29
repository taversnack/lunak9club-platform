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
  await expect(page.getByRole('heading', { name: "You don't have access to this page" })).toBeVisible();
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
  await page.getByRole('button', { name: 'Sign in with a password instead' }).click();
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
  await expect(page.getByRole('navigation', { name: 'Owner' })).toBeVisible();
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
  await expect(
    page.getByRole('main').getByRole('alert').filter({ hasText: 'Email or password is incorrect.' }),
  ).toBeVisible();
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
  await page.getByRole('button', { name: 'Sign in with a password instead' }).click();
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

  // Ask for the link through the sign-in page, keeping the way back.
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent('/account/bookings')}`);
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused();
  await expect(page.getByText('If that address has an account, a link is on its way.')).toBeVisible();
  const link = await latestLink(email, 'auth.magic-link');
  expect(link).toContain('/api/auth/magic-link/verify?token=');
  await page.goto(link);
  await expect(page).toHaveURL(/\/account\/bookings$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The same link a second time doesn't sign anyone in: back to sign-in, keeping the way back.
  await page.context().clearCookies();
  await page.goto(link);
  await expect(page).toHaveURL(/\/sign-in\?callbackUrl=%2Faccount%2Fbookings&error=INVALID_TOKEN$/);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'That link has expired or was already used. Request a new one.',
  );
  // Asking again from here still brings them back to the same page.
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await expect.poll(() => latestLink(email, 'auth.magic-link')).not.toBe(link);
  await page.goto(await latestLink(email, 'auth.magic-link'));
  await expect(page).toHaveURL(/\/account\/bookings$/);
});

test('magic link: an unknown address gets exactly the same reply, and resend says so', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(`nobody-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeFocused();
  await expect(page.getByText('If that address has an account, a link is on its way.')).toBeVisible();
  await page.getByRole('button', { name: 'Send the link again' }).click();
  await expect(page.getByText("We've sent another link. Use the newest one.")).toBeVisible();
  await page.getByRole('button', { name: 'Use a different email address' }).click();
  await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible();
});

test('magic link: a made-up or expired token lands on sign-in with the expired-link message', async ({ page }) => {
  await page.goto('/api/auth/magic-link/verify?token=not-a-real-token&callbackURL=%2Faccount');
  await expect(page).toHaveURL(/\/sign-in\?.*error=/);
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'That link has expired or was already used. Request a new one.',
  );
});

test('the Owner signs in with the password toggle', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with a password instead' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in with your password' })).toBeFocused();
  await page.getByLabel('Email address').fill(DEMO_OWNER.email);
  await page.getByLabel('Password').fill(DEMO_OWNER.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/admin/);
});
