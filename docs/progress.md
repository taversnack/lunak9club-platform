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
  - Customer: calendar with availability text, multi-dog/multi-date booking, review page with estimate and cancellation terms, bookings list, cancel with free/late notice, accept waitlist offers *(offers retired by D81/D82)*.
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

- 2026-10-04 — **Vaccination compliance (licence guidance 9.4)** – branch `dev1/vaccination-compliance`:
  - D73: core (DHP) and leptospirosis problems (missing, waiting for review, not accepted, new copy needed, expired, running out before the date) are hard blocks with no override at every booking path – customer, Owner (including trial days), membership book-ahead, accepting a waitlist place – and at a new check-in gate. Kennel cough stays overridable with a reason (kept on the booking at check-in, audited without details). Licence vaccinations can't be made optional in settings. Pure rules in `src/domain/compliance/attendance.ts`.
  - D74: upload asks “Is this your dog’s first course of vaccinations?” and the date it finished; stored as `compliance_submissions.primary_course_completed_on`, correctable by the Owner at review; blocks attendance until 14 days after. Customer sees the earliest start date.
  - D75/D66: reminders 60/30/14/7 days (default changed; rows still on 30/14/7 updated, Owner-edited rows kept).
  - Migration: `0015_vaccination_compliance` (nullable column, default change, guarded UPDATE), after Developer 2's `0014_dog_register_fields`; branch stacked on `dev2/dog-register-fields` (PR #3). The first-course date is separate from the per-vaccination date given (D68).
  - Docs: D11, D40, D42, D66 amended; D73–D75 added; O15 closed; O16 (titre certificates) opened.

- 2026-10-13 — **Booking requests and approvals** (D76–D85), branch `dev2/booking-approval`:
  - Generic approvals: `approval_requests` (one pending per subject), type registry, state machine, `approvals.manage` / `approvals.self.manage`; Owner **Requests** page (all types, oldest first) with nav link and dashboard count.
  - `booking.request`: customer bookings (ad hoc, members' extra days, trial days) become `requested` days that hold their place with the price fixed at request time; no payment until approved. Wording “does not secure your booking” on the form, the confirmation screen and a new confirmation email.
  - Approve: vaccination re-check; priced days held as `pending_payment` (24 h or until the session starts, min 31 min) with a pay link email (“pay to secure”, deadline in London time); £0 and membership days confirmed. Decline (whole request or one day), withdraw, expiry at the cut-off (one email per request). Owner notes stay in the portal.
  - Manual waitlist: join when full, leave any time, Owner removes; **Give place** makes its own booking and is blocked up front (reason shown, button disabled, refused on the server) for a dog failing the vaccination check. Waitlist offers, offer warnings and the offer-hours setting are retired.
  - Customer **Your requests** page (all approval types) with a withdraw confirmation; a failed approval attempt (e.g. a vaccination ran out) keeps the request waiting and shows the Owner why (`last_error`).
  - Pay links survive a card-service outage: checkout creation is retried; otherwise the places stay held, the customer gets “Pay now” (created on demand, never duplicated) and a friendly “try again” message, and the Owner sees “Resend pay link” on Requests and the day view; link-less holds lapse at their deadline.
  - Migration `0016_booking_approvals`, generated after Developer 1's 0015 (PR #4) merged (see `drizzle/NOTES.md`).

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

## Current (9 Nov 2026)
Phase 8 (hardening and launch) is in progress. Nothing is deployed; no live Stripe keys, no real email, no spend. The booking, billing, compliance and membership work from Phases 1–7 and the October branches (booking requests D76–D85, dog register D68–D72, membership workflow D86–D94, month-end in one tap D95) is merged to main.

Merged since the October branches (PRs up to #132, 30 Oct – 9 Nov 2026):
- **Booking rules and customer pages:** one trial day per dog (D96, waitlisted trials count, D103); customer Book page with full days only and Available / Full – join the waitlist, no counts (D100, D101); sticky request bar with the approved reassurance line (D108, “at least 48 hours before”); the 48-hour boundary fixed so exactly 48 h is free (D8, D39); half days removed for new bookings with existing ones honoured (D100, D105, migration 0024); customer `/account` overview with Next up, Needs you and a timeline; read-model fields `endedReason` (payment time ran out, request closed, cancelled by you or the club, declined) and `paymentState` (none, paid, refund requested, refunded, credited, charged with no refund) with no raw ids exposed.
- **Owner:** Today as one ordered inbox on `ownerInbox` (D77); full-day capacity count; Recent activity cards on phones; “at least N hours” setting label.
- **Sign-in and privacy:** emailed magic link first, password as fallback (D99); per-address magic-link rate limit and lock-out; sessions: IP and user agent cleared 30 days after a session ends (D110).
- **Virus scanning (D30, D109):** parts 1 and 2 merged: migration 0025 (`held` scan status), a clamd client, upload scanning, scheduler retry and quarantine. It is **off by default (`SCANNER_MODE=off`) and must stay off** until part 3 (Owner opens a held file only with a warning and an audit entry, plus the `document_held` inbox item) is merged **and** Stephen approves the extra memory (about 2 GB, a paid host-size item). Deviation from D109 as built: a fresh infected upload is refused outright and nothing is stored (stricter than quarantine). A file found infected later, on a scheduler retry, keeps its row (marked infected, with display name and checksum) but its bytes are deleted. In both cases an audit event and an Owner email with no file, dog or customer names are the record.
- **Robustness:** email transport is provider-neutral and production-capable (SMTP host, TLS, credentials validated in production; no provider chosen, D102); health endpoint checks the database and migrations; no overlapping queries on a transaction (pg 9 safe); jobs store the error name only; Stripe webhook signature and concurrent-duplicate tests; refund boundary tests; nodemailer 10.1.4.
- **Deployment:** `docs/deployment.md` runbook for a Node container or VPS (D107), a Dockerfile (runtime and tools targets, pnpm pinned), production alerting notes, scheduler tick interval note (15 minutes works; 10 or less preferred). Hosting shortlist and Airbnb layout research in `docs/research/`.
- **Design:** Airbnb-style direction with Luna's K9 Club brand (D111, plan approved D112: tab bar Book, Bookings, Dogs, Account; trust facts off the public site until supplied). Design blocks (radius tokens, ListingCard, CardGrid, PlaceholderMedia) are merged but no page uses them yet.

Also merged 9 Nov: D30 parts 2 and 3 (scan uploads, hold when the scanner is down; the Owner opens a held file only after a warning and a same-origin POST, with an audit entry; retry guards), the `document_held` inbox item, the customer shell with header, phone bottom tab bar and Dogs page (#136) and its accessibility fixes (#145), an enforcing CSP, finish-signup hardening, auth log fixes, the esbuild and minimatch overrides (`pnpm audit` clean) and the production go-live checklist. Still to come: one PR per customer page (home, sign-in, dogs, bookings, book, membership, invoices, overview), the ended-booking lines on the account overview, and the tester's remaining checks (the `document_held` Today row in a browser, forgot-password and verify-email rate limits, real-browser zoom, a final `pnpm verify` after the last merge).

Open PRs (11 Nov), each waiting on the tester's explicit PASS and green CI: #149 (per-address rate limit for forgot-password and verify-email), #150 (Home page), #151 (onboarding audit-metadata test diagnostics; the cause of the intermittent d5fdede failure is not proven). Frontend customer page queue, one PR each: Home (#150), sign-in, dogs, bookings, book, membership, invoices, overview with ended-booking lines, Today `document_held` restyle. Docker was down on the Mac on 11 Nov, so integration, e2e and a11y runs for these are pending.

Last full `pnpm verify` on main (tester, 9 Nov 2026, f5f1f87): OVERALL PASS in 4m04s, plus container builds (both targets), 24 migrations from zero, seed, `/api/health` 200, a local backup/restore drill and production-build rate-limit checks (sign-in, register, magic link). Not yet exercised: document bucket restore, RPO/RTO timing, managed-database restore, forgot-password and verify-email rate limits, a real Stripe test-mode run. Re-run `pnpm verify` after the last merges before calling the phase done.

Process note: #85, #131 and #132 were merged before the tester's gate had finished (the tester reviewed #131 and #132 afterwards and passed them; main's CI was green after #85). Merges now wait for the tester's explicit PASS and green CI.

## Decisions
- See `docs/decisions.md` (latest D112). Awaiting the Owner: D91 (decision notes shown only in the customer's account), D85 sub-defaults (unapproved dogs only, one dog and one date per request, ad hoc trial price), D71 (web-form consent as written consent), O11 (overdue handling – default proposed), the trust-block facts for the public site (D108), the midnight cut-off timing (see Risks), and the scanner memory cost (D109).

## Risks / known issues
- **Production email cannot work yet:** the SMTP code is ready, but no provider is chosen (D102), and `EMAIL_FROM` needs a verified sender domain and a safe test send.
- **Hosting is not chosen** (D107: a Node container or VPS with managed EU Postgres; shortlist in `docs/research/hosting-shortlist.md`; every option is paid). Nothing is signed up or deployed. Some hosts' schedulers run every 15 minutes at best.
- Nothing calls the scheduler in production yet (O12): needs a 10–15 minute caller with the bearer secret once hosting exists.
- Booking requests close at the first scheduler tick after midnight, so up to one tick after the 23:59 cut-off, and the approve path doesn't stop an approval in that window (low risk; Owner to decide if it matters).
- Card payments are tested against the simulated provider and Stripe's SDK, plus signature tests; a run with real Stripe **test** keys is still needed (O13).
- Terms are a placeholder (D34): solicitor-reviewed text needed.
- Virus scanning is built but off (see Current).
- Checking in a dog whose Owner-made booking is still awaiting payment isn't possible: the customer pays first (or the Owner cancels and rebooks at £0 with a customer rate).
- CI skips the S3 adapter test (no S3 server in CI); covered locally.
- The "destination stream closed early" server log on aborted navigations looks like harmless dev noise; not reproduced.
- Staff Manager/Staff roles are not created (D13); the permission map is ready.
- Web-form consent as "written consent" is not yet confirmed by the Owner and council (D71).
- Register answers are overwritten (with when and who for consents); append-only, effective-dated register history and an inspector register export are a later phase (D72).
- Developer note: after a production `pnpm build`, delete `.next` before running `pnpm dev` in the same checkout, or dev can loop. Parallel e2e runs need distinct `E2E_PORT` values.

- Follow-ups from the vaccination compliance work: (1) licence guidance 23.1 / brief D42 note – require a screening (meet-and-greet) record at check-in, not built yet; (2) titre certificates for DHP not supported (O16); (3) the retention job clears the reminder log after 90 days, so an "expired" reminder can be sent again ~90 days later – assigned to Developer 3; (4) the customer data download doesn't include vaccination record details.
- `storage.test.ts` now skips cleanly when `moto_server` (local S3) isn't installed (PR #1, merged into main and into this branch's base); it no longer fails `pnpm test:int` on the shared build box.

## Next
- Finish D30 part 3 and the customer page PRs (D111, D112), then the final verification and deploy-readiness pass (verify, container build, migrations from zero, backup and restore drill, rate-limit run).
- Owner decisions and approvals listed above; hosting, email provider and scanner memory are paid items for Stephen to approve before any use.
- Go-live checklist (not before the Owner approves): hosting and domain, production email, Stripe test-key run and then live keys, solicitor-reviewed terms, real photos.
