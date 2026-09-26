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
