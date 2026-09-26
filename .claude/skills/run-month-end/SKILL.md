---
name: run-month-end
description: Safely preview and run membership month-end invoicing in local/test only, with a reconciliation report. Never sends live email or creates live charges.
---
Safety gate — abort unless ALL are true: `NODE_ENV` is not `production`; `STRIPE_SECRET_KEY` starts with `sk_test_`; `EMAIL_SANDBOX=1`; `DATABASE_URL` host is local or a named test branch. Live runs require explicit Owner approval in the conversation.

1. Choose billing month (default: current month in Europe/London).
2. Preview: per customer — membership, scheduled days, closures removed, credits, expected total.
3. Detect: active memberships with no scheduled days, dog-days already billed, bookings without price snapshot, customers with blocked compliance.
4. Run `membership-invoicing` job twice; confirm the second run creates nothing.
5. Validate each draft's PDF total equals the sum of lines; payment sessions are test-mode.
6. Output reconciliation: counts, totals, exceptions, and the `job_runs` ids.
