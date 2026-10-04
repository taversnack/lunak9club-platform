# Progress

## Completed
- 2026-09-26 — Phase 0 discovery: `docs/discovery.md`; decisions D1–D27 in `docs/decisions.md`; ADRs 0001 (stack/hosting), 0002 (billing), 0003 (auth/access).
- 2026-09-26 — `CLAUDE.md`; `.claude/` agents (9), skills (8), settings + guard hooks.
- 2026-09-26 — **Phase 1 Foundation** complete:
  - Next.js 16 / React 19 / TypeScript 6 strict, pnpm, ESLint (domain-layer import ban), Prettier.
  - Docker compose: Postgres 16, Mailpit. (MinIO removed 26 Sep 2026 — image no longer on Docker Hub; local storage decided in Phase 2.) `.env.example`, `.gitignore`, `.gitleaks.toml`.
  - Drizzle schema + SQL migrations: users, sessions, accounts, verifications, rate_limits, roles, user_roles, audit_events (append-only triggers). Migration notes in `drizzle/NOTES.md`.
  - Better Auth: register → email confirmation (1 h) → sign-in; password reset (revokes sessions); rate limits; no account enumeration.
  - Roles Owner/Customer; permission map; single `authorize()`; page guards with audited denials; `pnpm owner:create` for the first Owner.
  - Audit trail with PII-stripping metadata; Owner dashboard shows recent activity.
  - Design tokens + components (Button, Field, Alert, StatusBadge, Card); sign-in, register, verify, forgot/reset, account and owner shells; skip link; status never colour-only.
  - Tests: 14 unit, 16 integration/authz (real Postgres), 17 E2E × 2 viewports incl. axe WCAG 2.2 AA. CI workflow (GitHub Actions). `pnpm verify` report.

- 2026-09-26 — **Phase 2 Customer & dog onboarding** complete:
  - Migrations 0002–0003: customers, contacts, vets, dogs (+ health, behaviour, permissions), requirements, documents, submissions, assessments, versioned terms + acceptances. DB constraints: one waiting + one approved record per dog/vaccination, reasons required for rejections, microchip/weight/sex checks.
  - Pure checklist engine (`src/domain/compliance/evaluate.ts`) drives both customer and Owner views.
  - Storage adapter: local filesystem in development (MinIO images no longer publicly available), S3/R2-ready. Uploads checked by content, 10 MB, private random keys, 60 s signed links, every download audited.
  - Customer: details, contacts, terms, add/edit dog, vet, onboarding form, vaccination upload, checklist with next steps.
  - Owner: dashboard counts, review queue, customers + search, dog page (sensitive section, view audited), accept/ask for new copy/reject, assessments with private notes, approve/suspend/reject, requirement settings, publish new terms.
  - Emails: Owner "new records", customer "update needed" and "approved" — no sensitive details.

- 2026-09-26 — **Phase 3 Booking MVP** complete:
  - Migrations 0004–0005: booking_settings, closures (E&W bank holidays to 2028), service_days, bookings, booking_dogs (one live booking per dog per day; status/offer/cancel/check-out constraints).
  - Pure rules (`src/domain/booking/rules.ts`): London times incl. clock changes, 23:59 cut-off, 90-day window, sessions and capacity (full day = morning + afternoon), taxi seats, 48 h cancellation, vaccination-by-date, estimate.
  - Atomic booking: each day's row is locked before capacity is checked; 12 simultaneous requests for 2 places → exactly 2 booked, 10 waitlisted (tested on separate connections).
  - Customer: calendar with availability text, multi-dog/multi-date booking, review page with estimate and cancellation terms, bookings list, cancel with free/late notice, accept waitlist offers.
  - Owner: day view (capacity, dogs, warnings, taxi run, waitlist, per-day capacity, notes, cancel), week and month views, book a dog with audited overrides, check-in/out/no-show/undo, opening settings and closures, CSV exports (formula-injection safe, audited).
  - Seed: approved demo dogs Biscuit (Casey) and Rex (Jordan).

- 2026-09-26 — **Phase 4 Pricing and memberships** complete:
  - Migrations 0006–0007: price_books (no overlaps, DB-enforced), customer_rates, memberships, price_snapshots (locked by trigger), booking_dogs.kind + membership_id.
  - Pure pricing engine (`src/domain/pricing/engine.ts`): website prices, half day 50%, taxi included, trial bands, customer rates (dog-specific > customer-wide > membership > ad hoc), optional multi-dog discount, plain-English explanations.
  - Every booking (customer, Owner, membership) stores its price snapshot; later price changes never alter it.
  - Memberships: customer requests → Owner approves/declines → days booked 60 days ahead at the member rate (full days waitlisted and reported); change of days / leaving from the next allowed 1st (20th rule); Owner can end on a chosen day.
  - Screens: customer Membership page (prices, request, change, leave), prices on review and bookings pages; Owner Memberships, Prices (schedule/remove price lists), agreed prices on customer page, trial-day pricing on Book a dog.

- 2026-09-26 — **Re-theme** to match lunak9club.co.uk (D50): navy header/footer with the site logo (`public/brand/lunak9-logo.png`), sand primary buttons, Raleway self-hosted, square corners, home-page hero. Colours adjusted for WCAG AA.

- 2026-09-29 — **Phase 5 Invoicing** complete:
  - Renamed to Luna’s K9 Club throughout (D51). Not VAT registered.
  - Migrations 0008–0009: business settings, gap-free number sequences, invoices, lines, payments, credit notes, refund requests, job runs; triggers lock sent invoices, lines, payments and credit notes.
  - Membership drafts per customer and month from locked price snapshots, rebuilt nightly; approval refuses if the total changed (D54). Next-month invoices sent on the 28th 09:00, joining invoices immediately (D55). Numbers LK9DOUGIE-01… (D52).
  - Due in 5 days, one reminder at 15:30 on day 4, overdue shown on the dashboard (D24, D25, O11).
  - Refund requests raised automatically for free cancellations of invoiced member days; Owner approves (credit note) or declines; money to return listed under Refunds (D56). Credit notes LK9DOUGIE-CN-01….
  - Manual payment recording with a reason (card payments arrive in Phase 6, D53).
  - Invoice PDF (branded, company disclosures, "not registered for VAT"), invoice/reminder/refund emails, CSV export per month.
  - Screens: Owner Invoices, invoice detail, Refunds, Settings → Business, dashboard billing card; customer Invoices and invoice detail.
  - Scheduler: `/api/jobs/tick` (CRON_SECRET) and `pnpm jobs:tick`; daily jobs run once (D57). Nightly membership book-ahead now included.

- 2026-09-29 — **Phase 6 Card payments** complete:
  - Payment adapter: Stripe Checkout (GBP) and a simulated provider for development/tests; live keys refused outside production.
  - Migrations 0010–0011: checkout attempts, card refunds (locked), webhook events (idempotent), `pending_payment` bookings, booking invoices.
  - Pay at booking (D6, D60): places held 31 min while paying, counted against capacity, confirmed on payment with a paid LK9DOUGIE- invoice and receipt email; lapsed holds released by the scheduler; late payments for a taken place refunded automatically. Waitlist offers accepted → pay.
  - Owner bookings (D59): payment link emailed, place held up to 24 h.
  - Invoices: Pay by card button; overpayments refunded automatically.
  - Refunds (D58): automatic to card for free cancellations, approved member refunds and credits on card-paid invoices; failed refunds retried from Refunds; scheduler retries interrupted ones.
  - Webhook `/api/webhooks/stripe` with signature check and event de-duplication; return page and scheduler reconcile if a webhook is missed.

- 2026-10-04 — **Phase 7 Compliance and welfare** complete:
  - Migrations 0012–0013: incidents (+ updates, photos), daily welfare checks, reminder log, data requests; locks so licence records can't be edited or deleted except by the retention job.
  - Incident reports (D62): always shared with the customer, photos, append-only updates, acknowledgement, follow-up dates, Owner list.
  - Daily checks (D63): auto-shared and emailed when the licence says the owner must be told.
  - Reminders (D66, D67): vaccinations 30/14/7 days and on expiry (+ Owner summary and dashboard list), day-before booking reminders, offer-lapsing warnings – each sent once.
  - Retention (D64) and UK GDPR (D65): daily retention job, inactive-customer anonymisation, customer data download, deletion requests with Owner approval.

- 2026-10-04 — **Dog register fields** (licence Sch. 4 Part 4 para 25, guidance 9.8; D68–D72), branch `dev2/dog-register-fields`:
  - Migration 0014 (additive, nullable): vaccination date given; last worming and flea treatment dates; exercise restrictions; insurance (insurer, optional policy number); seven licence consents each with when and who answered; agreed emergency vet + when agreed. Check constraints keep each set consistent.
  - Customer: existing onboarding form gains treatment dates, exercise, insurance and a short grouped Consents section (under-1 mixing only asked for puppies); vaccination upload asks for the date given; vet page asks which vet to use in an emergency. No new pages. Dogs onboarded earlier get a gentle prompt, never a block.
  - Owner: dog page shows the new fields with “Missing” text badges for older dogs, “Answered by [name] on [date]” for consents, the agreed vet, and date given in review/history (correctable at review). Emergency list CSV adds the agreed vet.
  - Privacy: values never in audit metadata (sanitiser extended), logs (redaction paths extended) or emails; included in the customer data download; removed by anonymisation (agreed vet cleared, consent rows incl. “answered by” deleted).

## Verification (26 Sep 2026, cloud build workspace)
Phase 7 (4 Oct): `pnpm verify` → OVERALL PASS. 93 unit, 116 integration/authz (incl. 12 welfare/privacy), E2E incident → customer acknowledgement → daily check → data download on mobile + desktop; a11y scans on all new pages.

Phase 6 (29 Sep): `pnpm verify` → OVERALL PASS. 88 unit, 104 integration/authz (incl. 10 payments), E2E pays for bookings, an Owner-made booking and an invoice through the simulated card page on mobile + desktop; a11y scans pass.

Phase 5 (29 Sep): `pnpm verify` → OVERALL PASS. 84 unit (incl. billing rules), 94 integration/authz (incl. 19 billing), E2E incl. draft → approve → send → customer PDF on mobile + desktop, a11y scans on all new pages.

Re-theme: `pnpm verify` → OVERALL PASS (axe contrast checks on every page, mobile + desktop).

Phase 4: `pnpm verify` → OVERALL PASS. 70 unit (incl. pricing matrix), 75 integration/authz, 36 E2E + 24 a11y runs.

Phase 3: `pnpm verify` → OVERALL PASS. 45 unit, 58 integration/authz, 32 E2E + 24 a11y runs (mobile + desktop), axe scans on every new booking page.

Phase 2: `pnpm verify` → OVERALL PASS. 33 unit, 39 integration/authz (incl. S3 adapter against a local S3 server), 24 E2E + 24 a11y runs across mobile and desktop.

`pnpm verify` → OVERALL PASS: format, lint, typecheck, unit, integration+authz, drizzle-kit check, build, E2E, a11y, `pnpm audit --prod` (no high), gitleaks (no leaks).
Not yet run on the Owner's Mac — see README "First-time setup".

## Current
- Phase 7 done; awaiting Owner review. Next: Phase 8 (hardening and launch).
- Dog register fields (D68–D72) built on `dev2/dog-register-fields` (draft PR). **Developer 1’s migration must be regenerated as 0015 after 0014 lands** (see `drizzle/NOTES.md`); Developer 1 uses decision IDs from D73.

## Decisions
- See `docs/decisions.md`. Open: O6 (hosting before launch), O11 (overdue handling — default proposed), D71 (web-form consent as written consent).

## Risks / known issues
- Nothing calls the scheduler in production yet (O12) – decide with hosting (O6).
- Card payments tested against the simulated provider and Stripe’s SDK types only; needs a run with real Stripe test keys (O13).
- Checking in a dog whose Owner-made booking is still awaiting payment isn’t possible – the customer pays first (or the Owner cancels and rebooks at £0 with a customer rate).
- Booking reminders and waitlist-offer expiry emails not yet sent (scheduler exists now; Phase 7).
- No virus scanning of uploads (D30) — decide before launch.
- Terms are a placeholder (D34) — solicitor-reviewed text needed.
- CI skips the S3 adapter test (no S3 server in CI); covered locally.
- Vercel Hobby is non-commercial (O6) — decide before public launch.
- Server logs show occasional "destination stream closed early" when a client navigation aborts an in-flight page stream; no test impact. Investigate in Phase 8.
- Sessions list shows IP/user agent columns (Better Auth defaults); retention rule for sessions to be set in Phase 7.
- Staff Manager/Staff roles not created (D13) — permission map ready.
- Web-form consent as “written consent” not yet confirmed by the Owner and council (D71).
- Register answers are overwritten (with when/who for consents); append-only, effective-dated register history and an inspector register export are a later phase (D72, brief recommendation 1).
- The 2-week primary-course rule (O15) isn’t enforced, although the date given is now recorded.

## Next
- Phase 8: hardening and launch – security review, backups and a tested restore, error monitoring, performance and accessibility pass, hosting decision (O6, O12, O13), go-live checklist.
