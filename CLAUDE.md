# Luna’s K9 Club Platform — guidance for Claude

UK doggy daycare platform: **booking & attendance**, **invoicing & payments**, **compliance & welfare**.
Single business, single site. Staff role at launch: **Owner** only (plus Customer).

Read first: `docs/decisions.md` (approved decisions win), `docs/discovery.md`, `docs/adr/`, `docs/progress.md`.

## Stack
Next.js App Router · TypeScript strict · pnpm · PostgreSQL (Drizzle + SQL migrations) · Better Auth · Stripe · Resend · document storage adapter (local filesystem in development, Cloudflare R2 via S3 in production) · Vitest · Playwright · axe-core. See ADR 0001.

## Commands
| Command | Purpose |
|---|---|
| `pnpm dev` | Run app (needs `docker compose up -d` for Postgres and Mailpit) |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | Create migration / apply locally / seed demo data |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:int` · `pnpm test:e2e` · `pnpm test:a11y` | Quality checks |
| `pnpm jobs:tick` | Run one scheduler tick locally (`JOBS_NOW=… ` to rehearse a date) |
| `pnpm verify` | Everything CI runs; must pass before a phase is called done |

## Layout
```
src/app/          routes, server actions (thin: validate → authorize → call domain)
src/domain/       pure TS: pricing, capacity, booking, billing, compliance (no Next/Drizzle imports)
src/infra/        adapters: db, auth, email, storage, pdf, payments (Stripe + simulated)
src/server/services/  use cases: take (db, actor, input), validate with Zod, authorise, transact, audit
src/server/policy authorize(actor, action, resource) — the only permission check
src/ui/           design system components
tests/            unit, integration (real Postgres), authz, e2e
```

## Conventions
- Tables snake_case plural; TS camelCase. Money columns are integer pence named `*_pence`. Never floats for money.
- Service dates are SQL `date` in `Europe/London` (`service_date`); instants are `timestamptz` UTC.
- UI copy: plain UK English, `en-GB`, GBP. Never show status by colour alone.
- Zod validation at every server boundary. No `any` without a comment explaining why.

## Non-negotiables
1. Every server action, route handler, query helper, storage URL and job calls `authorize()`. UI hiding is not security.
2. Capacity reservation, invoice finalisation, credits and payment reconciliation run in DB transactions.
3. Jobs and webhooks are idempotent (unique keys) and safe to retry. Stripe webhook signatures verified.
4. Finalised invoices, invoice lines and price snapshots are never updated; corrections are credits/adjustments.
5. No medical, behavioural, payment, auth or contact data in logs, errors, analytics or email bodies.
6. No destructive migration without a documented rollback/backfill plan (`/create-migration`).
7. Never use live Stripe keys, send real customer email, deploy to production or run a live month-end without explicit Owner approval in the conversation.
8. Anything that costs money (paid tier, domain, add-on) is flagged to the Owner before it is used.
9. Do not invent business rules — check `docs/decisions.md`; if missing, ask and record.

## Definition of done
Acceptance criteria met · permissions enforced server-side and tested · migrations reviewed · `pnpm verify` passes · accessibility/responsive checked · audit/error handling in place · wording clear · docs + `docs/progress.md` updated · no secrets or personal data committed · short verification report listing commands actually run and any failures.

## Working with subagents and skills
- Agents in `.claude/agents/` advise or implement within their area; the lead agent integrates, reviews diffs and runs the full verification.
- Never let two agents edit the same file in parallel.
- Skills: `/plan-feature`, `/implement-slice`, `/review-pricing`, `/run-month-end`, `/compliance-check`, `/security-review`, `/verify-release`, `/create-migration`.
