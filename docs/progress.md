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

## Verification (26 Sep 2026, cloud build workspace)
Phase 3: `pnpm verify` → OVERALL PASS. 45 unit, 58 integration/authz, 32 E2E + 24 a11y runs (mobile + desktop), axe scans on every new booking page.

Phase 2: `pnpm verify` → OVERALL PASS. 33 unit, 39 integration/authz (incl. S3 adapter against a local S3 server), 24 E2E + 24 a11y runs across mobile and desktop.

`pnpm verify` → OVERALL PASS: format, lint, typecheck, unit, integration+authz, drizzle-kit check, build, E2E, a11y, `pnpm audit --prod` (no high), gitleaks (no leaks).
Not yet run on the Owner's Mac — see README "First-time setup".

## Current
- Awaiting Owner review of Phase 3. Next: Phase 4 (pricing engine + memberships).

## Decisions
- See `docs/decisions.md`. Open: O6 (hosting before launch), O11 (overdue handling — default proposed).

## Risks / known issues
- Bookings confirm without payment until Phase 6 (D35); memberships arrive in Phase 4.
- No reminder emails yet (booking reminders, offer expiry) — needs the scheduled-jobs runner (Phase 5/7).
- No virus scanning of uploads (D30) — decide before launch.
- Terms are a placeholder (D34) — solicitor-reviewed text needed.
- CI skips the S3 adapter test (no S3 server in CI); covered locally.
- Vercel Hobby is non-commercial (O6) — decide before public launch.
- Server logs show occasional "destination stream closed early" when a client navigation aborts an in-flight page stream; no test impact. Investigate in Phase 8.
- Sessions list shows IP/user agent columns (Better Auth defaults); retention rule for sessions to be set in Phase 7.
- Staff Manager/Staff roles not created (D13) — permission map ready.

## Next
- Phase 4: effective-dated price books, membership plans (weekly pattern, member rates, recurring bookings), quote snapshots replacing the interim estimate, customer-specific rates.
