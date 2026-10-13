# Test strategy and matrix

| Layer | Tool | Location | Runs in |
|---|---|---|---|
| Unit | Vitest | `tests/unit` | `pnpm test` |
| Integration (real Postgres, migrated from zero each run) | Vitest | `tests/integration` | `pnpm test:int` |
| Authorisation | Vitest | `tests/integration/authz` + unit `authorize.test.ts` | `pnpm test:authz` |
| End-to-end (Pixel 7 + desktop Chrome) | Playwright | `tests/e2e/*.spec.ts` | `pnpm test:e2e` |
| Accessibility (WCAG 2.2 AA, axe) | Playwright + axe | `tests/e2e/a11y.spec.ts` | `pnpm test:a11y` |

## Phase 1 acceptance criteria → tests

| Criterion | Test |
|---|---|
| Customer can register, must confirm email, then reaches their account | `auth-flow.test.ts`, `auth.spec.ts › customer registers…` |
| Sign-in refused before email confirmation | `auth-flow.test.ts › refuses sign-in until…`, `auth.spec.ts` |
| Password reset works once, revokes old sessions | `auth-flow.test.ts › resets the password…`, `auth.spec.ts › customer resets…` |
| Wrong password / unknown email give the same response | `auth-flow.test.ts › rejects a wrong password…` |
| Sign-in is rate-limited | `auth-flow.test.ts › rate-limits…` |
| Anonymous users can't reach account/admin | `auth.spec.ts › anonymous visitors…` |
| Customers can't reach the owner area or owner queries | `auth.spec.ts › customers cannot…`, `admin-queries.test.ts` |
| Unknown roles grant nothing; self permissions need ownership | `authorize.test.ts` |
| Audit trail is append-only; metadata has no personal data | `db-invariants.test.ts`, `audit-metadata.test.ts` |
| Role changes are audited and idempotent | `admin-queries.test.ts › role changes` |
| Pages meet automated WCAG 2.2 AA checks; skip link works | `a11y.spec.ts` |

## Phase 2 acceptance criteria → tests

| Criterion | Test |
|---|---|
| Checklist rules: expiry on the day, 30-day warning, expired blocks booking, renewals, rejections, latest assessment wins, optional items, suspension | `compliance-evaluate.test.ts` |
| Uploads checked by content (PDF/JPEG/PNG/WEBP/HEIC), 10 MB limit, harmless names | `time-and-files.test.ts`, `onboarding.test.ts › checks uploads…`, `onboarding.spec.ts` |
| London dates across midnight, clocks changing, month/year ends | `time-and-files.test.ts` |
| Storage: filesystem round-trip, path escape refused, S3 round-trip + 60 s signed URL | `storage.test.ts` |
| Profile, dog, vet, contact, onboarding form validation with field messages | `onboarding.test.ts`, `onboarding.spec.ts` |
| One upload covers several vaccinations; newer upload replaces what's waiting | `onboarding.test.ts` |
| Owner can accept / ask for a new copy / reject with a reason; optimistic locking; email has no details | `onboarding.test.ts › Owner review` |
| Dog can't be approved until every required item is done; suspension needs a reason and blocks booking | `onboarding.test.ts` |
| New terms version must be accepted again | `onboarding.test.ts › a new terms version…` |
| Another customer gets "not found" for Alice's dog, edits, uploads and documents; attempt audited | `onboarding.test.ts › access control…`, `onboarding.spec.ts › another customer…` |
| Customers never see Owner-only notes; customers can't use Owner services | `onboarding.test.ts`, `onboarding.spec.ts` |
| Audit metadata contains no personal or health details | `onboarding.test.ts › audit metadata…` |
| New pages pass automated WCAG 2.2 AA checks (incl. forms showing errors) | `a11y.spec.ts`, axe scans inside `onboarding.spec.ts` |

## Phase 3 acceptance criteria → tests

| Criterion | Test |
|---|---|
| London times across clock changes; 23:59 cut-off; weekends, closures, 90-day window | `booking-rules.test.ts`, `bookings.test.ts › refuses today, weekends…` |
| Full day uses morning + afternoon; taxi seats counted separately; live offers hold places | `booking-rules.test.ts`, `bookings.test.ts › capacity…` |
| No overselling under concurrency (12 racers, 2 places) | `bookings.test.ts › never oversells the last places…` |
| Vaccination must be valid on the booked date | `booking-rules.test.ts`, `bookings.test.ts` |
| Unapproved or another customer's dog can't be booked | `bookings.test.ts` |
| Waitlist → Owner offer (held 12 h) → customer accepts; lapsed offers refused | `bookings.test.ts › waitlist offers` |
| Cancellation free at ≥48 h, late (charged) inside 48 h; today not cancellable online | `booking-rules.test.ts`, `bookings.test.ts › cancellations` |
| Owner overrides need a reason; check-in/out only on the day; optimistic locking | `bookings.test.ts › Owner day operations` |
| Capacity can't be set below places taken; days with bookings can't be closed | `bookings.test.ts` |
| CSV exports escaped against formula injection and audited; customers get 404 | `bookings.test.ts`, `booking.spec.ts` |
| Customer never sees Owner notes or other customers' bookings | `bookings.test.ts › access control` |
| End-to-end booking with estimate, free cancellation, Owner day view, check-in/out; axe on every page | `booking.spec.ts` |

## Phase 4 acceptance criteria → tests

| Criterion | Test |
|---|---|
| Website prices: ad hoc £50/£25, 1–3 days £48/£24, 4–5 days £45/£22.50, taxi included | `pricing-engine.test.ts › pricing matrix` |
| Band boundary 3 vs 4 days; trial-day bands; rounding; multi-dog discount when configured | `pricing-engine.test.ts` |
| Customer rates: dog-specific > customer-wide > membership > ad hoc; start/end dates | `pricing-engine.test.ts`, `pricing-memberships.test.ts` |
| Price books effective-dated, never overlap (DB), future only, removable before start | `pricing-memberships.test.ts › scheduled price changes` |
| Price locked at booking; snapshots immutable; later price changes don't alter them | `pricing-memberships.test.ts` |
| Membership request validation, approval books days ahead at member rate, skips closures, idempotent | `pricing-memberships.test.ts › memberships` |
| Full days waitlisted and reported, never overbooked | `pricing-memberships.test.ts` |
| Change/leave from next allowed 1st (20th rule), later days cancelled free | `pricing-engine.test.ts › membership rules`, `pricing-memberships.test.ts` |
| Members' extra days at member rate; other dogs at ad hoc | `pricing-memberships.test.ts` |
| Customers can't manage prices/memberships of others | `pricing-memberships.test.ts` |
| End-to-end: prices shown, request, Owner approval, member-rate bookings; axe on each page | `membership.spec.ts` |

## Booking requests and approvals (D76–D85) → tests

| Criterion | Tests |
|---|---|
| Approval status rules, subject keys, summaries, registry, authorisation (approvals.manage / self.manage / jobs.run) | `tests/unit/approvals.test.ts` |
| Status sets and `holdsPlace` (requested always holds; pending_payment only while live), owner hold length | `tests/unit/booking-rules.test.ts` |
| Request creates `requested` days + one approval request in one transaction, holds capacity, fixed price, wording in the email, owner note never emailed | `tests/integration/booking-requests.test.ts` |
| Approve → pending_payment + pay link (“pay to secure”), £0/membership → confirmed, vaccination re-check, reject, decline one day, withdraw (whole/day), expiry at cut-off, one pending request per subject, other customers refused | `tests/integration/booking-requests.test.ts` |
| Manual waitlist: join, leave, Owner removes without charge, Give place (priced and membership), Give place blocked up front for a dog failing the vaccination check (reason shown, nothing changes), no automatic offers | `tests/integration/booking-requests.test.ts`, `tests/integration/bookings.test.ts` |
| Failed approval attempt recorded (`last_error`) and shown to the Owner only, cleared on decision; Owner context lists other dogs booked that day with links | `tests/integration/booking-requests.test.ts` |
| Pay link robustness (D78): retry succeeds; persistent failure keeps the hold, is shown to the Owner (Requests + day view) with Resend, customer Pay now / old email link create it on demand, no duplicate checkouts, link-less holds lapse, no failure details in emails | `tests/integration/booking-requests.test.ts › pay links when the card service is down` |
| Customer “Your requests” page: list and withdraw any waiting request | `tests/e2e/requests.spec.ts`, a11y scan |
| Customer request → Owner approves on Requests → pay; wording on form, confirmation screen and email; withdraw; leave waitlist; Give place (button disabled with the vaccination reason, then enabled) | `tests/e2e/booking.spec.ts`, `tests/e2e/requests.spec.ts` |
| Accessibility of request, review, bookings, leave/withdraw and Requests pages | a11y scan (`tests/e2e/a11y.spec.ts`) |

## Vaccination compliance (D73–D75, licence guidance 9.4) → tests

| Criterion | Test |
|---|---|
| Core/leptospirosis: every record state (missing, waiting, not accepted, new copy, expired, runs out before the date) is a hard block; still blocks if settings say optional; kennel cough is overridable in every state | `vaccination-attendance.test.ts` |
| Owner booking refused for core/lepto in every state, even with a reason and as a trial day; kennel cough overridable with a reason (audited without details) | `vaccination-compliance.test.ts › Owner booking` |
| A reason still overrides closures, capacity and approval; trial days need no reason for approval | `vaccination-compliance.test.ts › Owner booking`, `bookings.test.ts › Owner day operations` |
| Customer booking refused for core/lepto in every state and for dates past expiry | `vaccination-compliance.test.ts › customer booking` |
| Membership book-ahead skips blocked days (first-course wait, lepto waiting for review) | `vaccination-compliance.test.ts › membership book-ahead` |
| Waitlist place can't be given (D82) while a licence vaccination is out of date | `vaccination-compliance.test.ts › Give place` |
| Check-in gate: refused for core/lepto in every state (no reason helps), kennel cough needs a reason (kept + audited), day view shows which applies | `vaccination-compliance.test.ts › check-in gate` |
| First course: day 13 blocked, day 14 allowed, no date no block – at customer booking, Owner booking and check-in; latest approved date wins | `vaccination-attendance.test.ts`, `vaccination-compliance.test.ts` |
| First-course question: must be answered, yes needs a past date, stored per vaccination, Owner keeps/corrects/clears it; UI question and error | `vaccination-compliance.test.ts › first-course question`, `onboarding.spec.ts` |
| Reminders 60/30/14/7: 60-day sent once, catch-up sends only the nearest, then 30; migrated rows and default; migration UPDATE keeps Owner-edited rows; settings accept 60,30,14,7 and refuse making licence vaccinations optional | `vaccination-attendance.test.ts`, `vaccination-compliance.test.ts › reminders` |

## Membership workflow (D86–D91) → tests

| Criterion | Test |
|---|---|
| Owner creates an account; invite is 7-day, single use, resend replaces it; finish signup sets a password | `tests/integration/membership-workflow.test.ts` (Owner creates a customer) |
| Customer days go to approval; one pending request per dog; the decline note never appears in email | same file (membership.days approvals) |
| Move one day: same month only; approved move swaps the date | same file (move_once) |
| Owner changes days without approval; customer emailed, no sensitive data; customers can't | same file (Owner changes days) |
| Monthly confirmation is idempotent; the job only counts, keeps days, names nobody | same file (monthly confirmation) |
| Owner change starts from the first month not invoiced; full day blocks | `tests/integration/pricing-memberships.test.ts` |
| Customer chooses days → Owner approves in Approvals → days at member rate | `tests/e2e/membership.spec.ts` |
