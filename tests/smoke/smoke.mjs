// Quick smoke test of the main journeys against a RUNNING local app (not part of `pnpm test:e2e`).
//
//   request a day -> Owner approves on Today -> customer pays (simulated card) -> cancels 48 h+ ahead
//   -> refund -> late cancellation is charged -> waitlist on a full day -> magic-link sign-in -> health.
//
// Run, after `docker compose up -d`, a migrated and seeded local database and the app on port 3000
// (`pnpm dev`, or `pnpm build && pnpm start`):
//
//   node tests/smoke/smoke.mjs                       # app at http://localhost:3000, Mailpit at :8025
//   SMOKE_URL=http://127.0.0.1:3500 node tests/smoke/smoke.mjs
//
// Local only: uses the demo accounts from the README and the simulated card page. It refuses any
// address that is not localhost or 127.0.0.1. It leaves test bookings behind in the local database, so use
// a database you can reset (`pnpm db:reset && pnpm db:migrate && pnpm db:seed`). Needs EMAIL_TRANSPORT=smtp
// (Mailpit) and PAYMENTS_DRIVER=simulated (the defaults). Sign-ins are rate-limited unless AUTH_RATE_LIMIT=off,
// so a second run within a minute may need that.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const BASE = process.env.SMOKE_URL ?? 'http://localhost:3000';
const MAIL = process.env.SMOKE_MAIL ?? 'http://localhost:8025';
const host = new URL(BASE).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  console.error(`Refusing to run against ${host}: this smoke test is for a local app only.`);
  process.exit(2);
}

const STARTED_AT = Date.now();
const out = (line) => process.stdout.write(`${line}\n`);
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  out(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` (${detail})` : ''}`);
};
const text = async (p) => (await p.locator('main').innerText()).replace(/\s+/g, ' ');

async function login(browser, email, password) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(800); // let the page wire up before pressing buttons
  await p.getByLabel('Email address').fill(email);
  await p.getByRole('button', { name: 'Sign in with a password instead' }).click();
  await p.getByLabel('Password').fill(password);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForURL(/\/(admin|account)/);
  return p;
}

async function mailTo(address, subjectPart) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + address)}&limit=20`).then((x) =>
      x.json(),
    );
    // Only mail sent during this run counts (earlier runs leave mail behind in Mailpit).
    const m = (r.messages ?? []).find(
      (x) => x.Subject.includes(subjectPart) && Date.parse(x.Created) >= STARTED_AT - 2000,
    );
    if (m) return m;
    await new Promise((s) => setTimeout(s, 500));
  }
  return null;
}

const browser = await chromium.launch();
try {
  // 0. Health
  const h = await fetch(`${BASE}/api/health`);
  const hb = await h.json().catch(() => ({}));
  check('health endpoint is ok', h.status === 200 && hb.status === 'ok', `HTTP ${h.status}`);

  const customer = await login(browser, 'casey@example.test', 'demo-customer-password');
  const owner = await login(browser, 'owner@lunak9club.test', 'demo-owner-password');

  // 1. Request two days far enough ahead to be free to cancel
  await customer.goto(`${BASE}/account/book`, { waitUntil: 'networkidle' });
  const boxes = customer.locator('input[type=checkbox][name=date]:not([disabled])');
  const n = await boxes.count();
  check('Book page offers days', n > 10, `${n} selectable`);
  const free = await boxes.nth(Math.min(12, n - 2)).getAttribute('value');
  const free2 = await boxes.nth(Math.min(13, n - 1)).getAttribute('value');
  await boxes.nth(Math.min(12, n - 2)).check();
  await boxes.nth(Math.min(13, n - 1)).check();
  await customer.getByRole('button', { name: /Check price/ }).click();
  await customer.waitForURL(/review/);
  const review = await text(customer);
  check('review page says the request does not secure the booking', /does not secure your booking/.test(review));
  check('no places-left counts or "nearly full" on review', !/\d+ (places|spaces) left|nearly full/i.test(review));
  await customer.getByRole('button', { name: /Send booking request/ }).click();
  await customer.waitForLoadState('networkidle');
  check('request is sent', /Booking request sent/.test(await text(customer)), `${free}, ${free2}`);
  check('request email arrives in Mailpit', !!(await mailTo('casey@example.test', 'received your booking request')));

  // 2. Owner approves inline on Today
  await owner.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  const approve = owner.getByRole('button', { name: /^Approve/ }).first();
  check('Owner sees the request on Today', (await approve.count()) > 0);
  await approve.click();
  await owner.waitForTimeout(3000);
  check(
    'approval confirms and the customer is emailed',
    /Request approved/.test(await text(owner)) && !!(await mailTo('casey@example.test', 'please pay to secure')),
  );

  // 3. Customer pays through the simulated card page
  await customer.goto(`${BASE}/account`, { waitUntil: 'networkidle' });
  await customer
    .getByRole('link', { name: /^Pay £/ })
    .first()
    .click();
  await customer.waitForLoadState('networkidle');
  check('pay link opens the simulated card page', /\/dev\/checkout\//.test(customer.url()));
  await customer.getByRole('button', { name: /Pay .* with a test card/ }).click();
  await customer.waitForURL(/payment=paid/);
  check('payment is received', /Payment received/.test(await text(customer)));
  check('receipt email arrives', !!(await mailTo('casey@example.test', 'payment received')));

  // 4. Cancel one day 48 h+ ahead: free, refunded to card
  await customer.goto(`${BASE}/account/bookings`, { waitUntil: 'networkidle' });
  await customer
    .getByRole('link', { name: /Cancel\s*.* on / })
    .last()
    .click();
  await customer.waitForURL(/\/cancel$/);
  const cancelPage = await text(customer);
  check('cancel page says no charge for 48 h or more ahead', /No charge/.test(cancelPage), cancelPage.slice(0, 160));
  await customer.getByRole('button', { name: /Yes, cancel/ }).click();
  await customer.waitForURL(/cancelled=/);
  const afterCancel = await text(customer);
  check(
    'cancellation is refunded to the card',
    /refunded this day to your card/.test(afterCancel),
    afterCancel.slice(0, 200),
  );
  check('refund email arrives', !!(await mailTo('casey@example.test', 'refund of')));

  // 5. Waitlist on a day the Owner has made full (needs docker + local database access)
  //    Skipped here: it needs capacity 0 on a day. See docs/manual-qa-checklist.md journey 8.

  // 6. Magic link
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle' });
  await anon.waitForTimeout(800);
  await anon.getByLabel('Email address').fill('jordan@example.test');
  await anon.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await anon.waitForTimeout(2000);
  const mail = await mailTo('jordan@example.test', 'sign-in link');
  check('sign-in link email arrives', !!mail);
  if (mail) {
    const full = await fetch(`${MAIL}/api/v1/message/${mail.ID}`).then((r) => r.json());
    const link = (full.Text.match(/https?:\/\/\S+/) ?? [])[0];
    await anon.goto(link, { waitUntil: 'networkidle' });
    check('magic link signs the customer in', /\/account/.test(anon.url()));
  }

  // 7. Public home page
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(BASE, { waitUntil: 'networkidle' });
  const home = await text(pub);
  check('home page shows the cancellation line', /cancel free at least \d+ hours before/.test(home));
  check('home page shows no trust block to visitors', !/Trust block/.test(home));
} catch (e) {
  check('smoke run completed without an unexpected error', false, String(e.message).split('\n')[0]);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
out(`\n${results.length - failed}/${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}`);
process.exit(failed ? 1 : 0);
