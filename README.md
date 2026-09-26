# LunaK9 Club Platform

Booking, invoicing and compliance for LunaK9 Club dog day care.

- **Phase 1 (Foundation):** sign-up with email confirmation, sign-in, password reset, Owner and Customer roles enforced on the server, append-only audit trail, design system, tests and CI.
- **Phase 3 (Bookings):** calendar booking of full days, mornings or afternoons (with or without the dog taxi) for one or more dogs, price estimate before confirming, waitlist and offers, free/late cancellation, closures and bank holidays, Owner day/week/month views, check-in/out and no-shows, CSV attendance and emergency lists.
- **Phase 2 (Customer & dog onboarding):** customer details and contacts, dogs, vets, onboarding form (health, behaviour, permissions), vaccination record uploads, versioned terms, Owner review queue, meet-and-greet/trial records, dog approval, configurable requirements.

Start with [`CLAUDE.md`](CLAUDE.md), [`docs/decisions.md`](docs/decisions.md) and [`docs/progress.md`](docs/progress.md).

## Requirements

- Node.js 22+ and pnpm 10 (`corepack enable`)
- Docker Desktop (for local Postgres and Mailpit)

## First-time setup

```bash
corepack enable
pnpm install
cp .env.example .env
# put a random value in BETTER_AUTH_SECRET:  openssl rand -base64 32
docker compose up -d          # Postgres :5432, Mailpit :8025
pnpm db:migrate               # apply migrations to lunak9_dev
pnpm db:seed                  # fictional demo owner + customer
pnpm dev                      # http://localhost:3000
```

Uploaded documents are saved on your computer in `.data/uploads` (git-ignored) and are only ever opened through the app after a permission check. The live site will use Cloudflare R2 via the same storage adapter (`STORAGE_DRIVER=s3`).

Emails in development go to **Mailpit** at http://localhost:8025. Nothing is sent to real inboxes (`EMAIL_SANDBOX=1` only allows a local SMTP host).

### Demo accounts (local only, fictional)

| Role     | Email                 | Password               |
| -------- | --------------------- | ---------------------- |
| Owner    | owner@lunak9club.test | demo-owner-password    |
| Customer | casey@example.test    | demo-customer-password |

### Creating the real Owner account

People who register themselves always become **customers**. The Owner account is created from the command line:

```bash
OWNER_EMAIL=you@yourdomain OWNER_NAME="Your Name" OWNER_PASSWORD='a-long-password' pnpm owner:create
```

Leave out `OWNER_PASSWORD` to have one generated and shown once. Scripts refuse to run against a non-local database.

## Everyday commands

| Command                                              | What it does                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                           | Run the app with hot reload                                                                       |
| `pnpm db:generate --name <change>`                   | Create a migration after editing `src/infra/db/schema` (see `/create-migration`)                  |
| `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:reset` | Apply migrations · seed demo data · wipe the local database                                       |
| `pnpm lint` · `pnpm typecheck` · `pnpm format`       | Code quality                                                                                      |
| `pnpm test`                                          | Unit tests                                                                                        |
| `pnpm test:int`                                      | Integration + authorisation tests against real Postgres (`lunak9_test`, reset each run)           |
| `pnpm build && pnpm test:e2e`                        | End-to-end tests (mobile + desktop) against the production build                                  |
| `pnpm test:a11y`                                     | Automated WCAG 2.2 AA checks (axe)                                                                |
| `pnpm verify`                                        | Everything above plus migration check, dependency audit and secret scan; prints a pass/fail table |

First E2E run on a new machine: `pnpm exec playwright install chromium`.

## Project layout

```
src/app/          pages and route handlers (thin: validate → authorise → call domain)
src/domain/       pure business rules: compliance checklist, upload checks, London dates
src/infra/        adapters: db (Drizzle), auth (Better Auth), email, storage (local filesystem, or S3/R2), env, logger
src/server/       authorise(), session guard, roles, audit, services (customers, dogs, documents, owner review, terms)
src/ui/           design system components and tokens
drizzle/          SQL migrations (+ NOTES.md with data impact and rollback)
tests/            unit, integration, authz, e2e
```

## Security notes

- Every page, route and query checks permissions on the server (`src/server/policy`). Hiding a link is never the control.
- Sessions live in Postgres and are re-checked on every request; password reset signs out all other sessions.
- Sign-in, sign-up, reset and verification requests are rate-limited.
- `audit_events` is append-only at the database level.
- Documents are checked by their contents (not the file name), stored under random names in a private bucket, and only opened through the app after a permission check (S3/R2 links last 60 seconds). Every view is audited. There's no virus scanning yet (see D30).
- Health and behaviour details are visible only to the Owner and the dog's customer, and never go into emails, logs or the audit trail.
- Logs are structured and redact personal fields; don't log personal data anyway.
- Secrets only in `.env` (git-ignored). `.env.example` holds names only.

## Not yet covered (later phases)

Bookings, pricing, Stripe payments and webhooks, scheduled jobs (expiry reminders), backups and restore, and deployment are documented in `docs/discovery.md` and the ADRs and arrive in their phases. Deploying anywhere public needs the Owner's approval first (see ADR 0001 on hosting costs).
