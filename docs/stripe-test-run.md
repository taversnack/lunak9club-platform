# Stripe test-mode run (ready to run)

Purpose: prove the real Stripe integration end to end with **test** keys, in about 45 minutes, the moment Stephen supplies them. Until now only the simulated provider and the signature tests have run. Nothing here uses live keys, real customers or real email (CLAUDE.md rules 7 and 8); the app refuses live keys outside production anyway.

## 1. What is needed from Stephen (test mode only)

| Item | Looks like | Where it comes from |
|---|---|---|
| Secret test key | `sk_test_...` | Stripe Dashboard, test mode, Developers, API keys ("Secret key"). A restricted key also works if it can write Checkout Sessions and Refunds and read Payment Intents. |
| Webhook signing secret | `whsec_...` | Printed by `stripe listen` (section 3) for a local run; for a staging host, create a test-mode webhook endpoint pointing at `https://<APP_URL>/api/webhooks/stripe` and copy its signing secret. |

No publishable key is needed (the app redirects to Stripe's hosted checkout; no Stripe script runs on our pages). Keys go in `.env` (git-ignored) or the host's secret store, **never** in a chat, an issue or a commit. A Stripe account in test mode costs nothing.

## 2. Settings

Local run (Postgres and Mailpit up with `docker compose up -d`; do not start a second compose):

```
APP_ENV=development
APP_URL=http://localhost:3000
PAYMENTS_DRIVER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...        # from stripe listen, below
EMAIL_TRANSPORT=smtp                    # Mailpit at http://localhost:8025 (pay-link emails land here)
```

Then `pnpm db:seed` (demo data, local only), `pnpm dev`. Sign in as the demo Owner and customer shown in the README. For a staging host use `docs/deployment.md` section 2 plus the settings above.

## 3. Webhooks with the Stripe CLI

```
stripe login                                    # once; test mode
stripe listen --forward-to localhost:3000/api/webhooks/stripe \
  --events checkout.session.completed,checkout.session.expired,refund.created,refund.updated,refund.failed
```

Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`, restart `pnpm dev`, leave the command running in its own terminal. Every event it forwards appears there with the app's HTTP status (expect 200).

## 4. Scenarios

Test card numbers are from Stripe's testing documentation; check the page if one has changed: success `4242 4242 4242 4242`, generic decline `4000 0000 0000 0002`; any future expiry, any CVC, any postcode. Use a date at least 3 days ahead for refund scenarios and a fresh dog/date each time (one place per dog per day).

"Check in the app" means the customer's Bookings page, the Owner's Today, Invoices and Refunds pages. "Audit" means the Owner's Recent activity on the dashboard, or `select action, entity_type, created_at from audit_events order by occurred_at desc limit 20` in the dev database.

| # | Scenario | Steps | Expected: app | Expected: audit and data |
|---|---|---|---|---|
| 1 | Checkout paid (booking) | Customer requests a day; Owner approves on Requests; open the emailed pay link in Mailpit; pay with `4242...` | Returns to Bookings showing the day confirmed and a paid receipt invoice (LK9DOUGIE-NN). `stripe listen` shows `checkout.session.completed` 200 | `payment.checkout_started`, `payment.card_received`/`payment.booking_paid`; `webhook_events` row with `processed_at` set; `payments` row, one only |
| 2 | Declined card | Same, but pay with `4000 0000 0000 0002` | Stripe shows the decline on its page; the app is unchanged, places still held | No payment row; hold unchanged |
| 3 | Abandoned checkout | Open the pay link, close the tab. Then `stripe checkout sessions expire cs_test_...` (id from the Stripe dashboard) | After the webhook, the day is released and the "payment time ran out" email appears in Mailpit; Bookings shows the day as released | `checkout.session.expired` 200; `payment.checkout_released`; booking day `cancelled`, timeline reason "payment_expired" |
| 4 | Expired link (hold lapses by time) | Open pay link, do nothing. Run `JOBS_NOW=<hold deadline + 1 min> pnpm jobs:tick` | Same outcome as 3, with the pay link now saying the time to pay ran out | `payment.hold_released`; scheduler result lists it once; repeating the tick changes nothing |
| 5 | Webhook replay | Resend the `checkout.session.completed` event from scenario 1: `stripe events resend evt_...` (Dashboard, Developers, Events also has Resend). Also re-POST an old saved payload by hand after more than 5 minutes | Resend: app answers 200 `duplicate: true`, nothing changes. Hand-POST of an old signature: 400 (stale timestamp) | `webhook_events.attempts` increases to 2; still one `payments` row |
| 6 | Refund 48 h or more ahead (card-paid day) | After scenario 1, the customer cancels the day in the portal more than 48 hours before it starts | Cancellation says free; refund email; Bookings shows "refunded" | Stripe test dashboard shows a full refund; `card_refunds.status = succeeded`; credit note created; `refund.created`/`refund.updated` 200 |
| 7 | Cancel inside 48 h | Pay for a day starting in under 2 days (Owner books it), customer cancels | Marked late, still charged, no refund | No `card_refunds` row; Stripe shows no refund |
| 8 | Partial refund | Owner issues a credit note for part of a card-paid invoice (Owner, Invoices, the invoice, credit) | Refund of just that amount on Refunds | `card_refunds.amount_pence` equals the credit; Stripe shows the partial refund; invoice balance consistent |
| 9 | Failed refund and retry | Easiest: temporarily set `STRIPE_SECRET_KEY` to a restricted test key **without** Refunds write, restart, cancel a card-paid day 48 h+ ahead | The refund shows as failed on the Owner's Refunds page; the Owner is told | `card_refunds.status = failed`; then restore the full key, restart, press Retry: succeeds, `refund.card_retry` audited, one Stripe refund only. (Stripe also publishes a test card whose refund fails: `4000 0000 0000 5126`; check the testing page for the current number.) |
| 10 | Month-end invoice payment | Owner approves the month's draft (Invoices, "Approve all unchanged drafts"); run `JOBS_NOW=<28th 09:00> pnpm jobs:tick` so it is sent; customer opens the invoice and uses "Pay by card" | Invoice shows paid after returning; receipt shown | `checkout_attempts` with purpose invoice; `invoice.payment_recorded`; paying again offers nothing to pay |
| 11 | Webhook missed | Stop `stripe listen`, pay a booking, return to the app | The return page still confirms the payment | The scheduler's reconcile step also catches it on the next tick; no double payment when the webhook is later resent |

## 5. How this exercises the CSP

The app sends a Content-Security-Policy on every page (`src/domain/security/csp.ts`) whose `form-action` allows only our own address and `https://checkout.stripe.com`. Two kinds of redirect to Stripe exist, and only one is subject to `form-action`:

- **Pay now** buttons and the emailed link (`/api/payments/pay/...`, `/api/payments/pay-booking/...`) are plain links that the server answers with a redirect: not a form, so `form-action` does not apply.
- **Pay by card on an invoice** is a form (server action) that redirects to Stripe: this one is checked by `form-action`. Scenario 10 is the test.

For each pay path, open the browser console (Developers tools, Console) before clicking and watch for `Refused to send form data ... because it violates the following Content Security Policy directive: "form-action ..."` or any `Content-Security-Policy` message. Expected: none. If the invoice button is blocked, the fix is in `CARD_CHECKOUT_ORIGIN` / the `form-action` list in `src/domain/security/csp.ts` (Stripe could redirect through a different host), with a unit test; record the exact blocked address.

## 6. After the run

- Fill in a results table (scenario, pass/fail, notes, any Stripe event id) and add it to `docs/progress.md` with the date.
- Anything that did not behave as expected becomes a bug with the Stripe event id and the audit rows; do not "fix" by changing expectations.
- Delete the keys from `.env` or rotate them in the Stripe dashboard if the machine is shared; revoke the CLI login (`stripe logout`).
- Going live is a separate step that needs the Owner's explicit approval and live keys set only in production (`docs/deployment.md`, Before go-live).
