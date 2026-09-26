# ADR 0001 — Stack and hosting

- Status: Accepted (hosting providers provisional until go-live review)
- Date: 2026-09-26

## Context
Greenfield build for a single UK daycare. Owner wants free tiers in London/UK-EU regions to start, with any paid service flagged in advance.

## Decision
- **App:** Next.js (App Router), TypeScript strict, pnpm. Domain logic in `src/domain` with no framework imports.
- **Database:** PostgreSQL. Local: Docker Postgres 16. Hosted: **Neon Free**, region `aws-eu-west-2` (London).
- **ORM/migrations:** Drizzle + drizzle-kit SQL migrations, committed and reviewed.
- **Auth:** Better Auth (email/password, verification, reset, sessions in our DB) behind `AuthProvider`.
- **Files:** S3-compatible adapter. Hosted: **Cloudflare R2 Free** with EU jurisdiction bucket. Local: filesystem (`STORAGE_DRIVER=fs`, `.data/uploads`). MinIO was tried first but its images are no longer publicly pullable (Docker Hub removed Sept 2026; quay.io returns 401 without a login). SeaweedFS is the fallback if we want a local S3 server later.
- **Email:** Resend Free behind `EmailProvider`; local: Mailpit (never sends externally).
- **Payments:** Stripe (test mode until approved go-live). No monthly fee; per-transaction fees apply.
- **Hosting:** Vercel Hobby, functions pinned to `lhr1` (London), for development/private preview only.
- **Jobs:** Vercel Cron → idempotent `/api/jobs/*` endpoints with `job_runs` unique (job, period).
- **Monitoring:** Sentry free developer plan, EU data region, PII scrubbing.
- **CI:** GitHub Actions (free minutes).

## Known limits / costs to flag before go-live
| Item | Limit or cost | When it matters |
|---|---|---|
| Vercel Hobby | Non-commercial use only | **Before public launch** → Vercel Pro (paid, per seat) or Cloudflare Workers via OpenNext |
| Neon Free | Small storage allowance; compute scales to zero (cold starts) | Unlikely to bind at single-site scale |
| Resend Free | Low daily send cap | Month-end if many customers are invoiced on one day → queue across days or upgrade |
| Stripe | Per-transaction fee (standard UK cards ~1.5% + 20p) | Every payment; Direct Debit option later can lower membership fees |
| Domain | Registration fee (small annual cost) | Before sending email from our own domain |
| Vercel Cron on Hobby | Limited frequency | Reminder/expiry jobs designed to run daily |

## Consequences
All providers sit behind adapters; switching hosting or email is a config change plus adapter, not a rewrite.
