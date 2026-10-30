# Deployment, backup and environment reference

Status: **not deployed.** Hosting is undecided (O6, O12) and anything that costs money needs the Owner's approval first. This document is hosting-neutral. Source of truth for settings: `src/infra/env.ts` and `.env.example`.

## 1. Known gaps to close before go-live

1. **Outbound email has no SMTP login.** `src/infra/email/providers.ts` creates the SMTP transport with host, port and `secure: false` only. Production requires `EMAIL_TRANSPORT=smtp`, but a real mail provider needs a username, password and usually TLS. `RESEND_API_KEY` appears in `.env.example` but nothing reads it. This needs a small code change (SMTP user/password/secure settings, or a Resend adapter) and a provider choice (possible cost: Owner approval).
2. Hosting and scheduler (O6, O12) undecided.
3. No virus scanning on uploads (D30).

## 2. Environment variables

"Prod" = required or constrained when `APP_ENV=production`; the app refuses to start otherwise (names only are reported, never values).

| Variable | Default | Prod | Notes |
|---|---|---|---|
| `APP_ENV` | development | `production` | Must be set for any production build (`next start`). `test` for e2e. |
| `APP_URL` | http://localhost:3000 | must be `https://` | Public address; used in links and cookies (secure cookies when https). |
| `BETTER_AUTH_URL` | `APP_URL` | optional | Override only if auth is served from another origin. |
| `BETTER_AUTH_SECRET` | none | required, 32+ chars | `openssl rand -base64 32`. Changing it signs everyone out. |
| `DATABASE_URL` | none | required | PostgreSQL 16. Use a TLS connection from a managed host. |
| `EMAIL_TRANSPORT` | console | `smtp` | `file` and `console` are for tests and development. |
| `EMAIL_FROM` | test address | set | Sender shown to customers; domain must be verified with the mail provider. |
| `EMAIL_SANDBOX` | 1 | `0` | 1 = never send to real addresses. |
| `SMTP_HOST` / `SMTP_PORT` | localhost / 1025 | set | See gap 1 about credentials. |
| `MAIL_DIR` | .tmp/mail | n/a | `file` transport only. |
| `AUTH_RATE_LIMIT` | on | keep `on` | Off only in automated tests. |
| `TRUSTED_PROXIES` | empty | one of these two required when rate limit is on | Own proxies' IPs/CIDRs. See README "Deploying: client addresses and rate limits". |
| `CLIENT_IP_HEADER` | unset | (see above) | A header the edge always overwrites, e.g. `cf-connecting-ip`, `x-real-ip`. |
| `STORAGE_DRIVER` | fs | `s3` | `fs` is local development only. |
| `STORAGE_DIR` | .data/uploads | n/a | `fs` only. |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | none | required with `s3` | Private bucket (ADR 0001: Cloudflare R2, EU jurisdiction). |
| `S3_REGION` | eu-west-2 | optional | R2 uses `auto`. |
| `S3_PUBLIC_ENDPOINT` | none | optional | Public address used in signed links if different from `S3_ENDPOINT`. |
| `S3_FORCE_PATH_STYLE` | 1 | check provider | |
| `PAYMENTS_DRIVER` | simulated | `stripe` | |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | none | required with `stripe` | Live keys only with the Owner's explicit approval (CLAUDE.md rule 7). Live keys are refused outside production. |
| `CRON_SECRET` | none | required, 32+ chars | Bearer token for `/api/jobs/tick`; the scheduler is off without it. |
| `LOG_LEVEL` | info | optional | fatal, error, warn, info, debug. |
| `TEST_DATABASE_URL`, `E2E_*` | n/a | not used | Test tooling only. |

Never commit real values. Secrets live in the host's secret store.

## 3. Health endpoint

`GET /api/health` (no login). Returns `200 {"status":"ok","checks":{"database":"ok","migrations":"ok"}}`. Returns `503 {"status":"degraded"}` if the database is unreachable, migrations are pending, or the environment configuration is invalid. `migrations: "unknown"` means the migration journal isn't shipped with the build (still 200). No settings, errors or personal data are exposed. Use it for the host's health check and uptime monitor.

## 4. Scheduler (O12)

Daily and monthly jobs (nightly membership drafts and book-ahead, month-end sends, reminders, hold expiry, retention, payment reconciliation) run from one tick endpoint: `POST /api/jobs/tick` with `Authorization: Bearer $CRON_SECRET` (GET also works for hosts whose cron only does GET). Wrong or missing secret gives 404.

- Call it every 10 minutes (invoice sends are 09:00 and reminders 15:30 London time, so hourly-or-less is too coarse). Jobs are idempotent: unique run keys mean a repeated or overlapping call does nothing twice.
- Who calls it is undecided: options in O12 (a Cloudflare Workers cron trigger on the free tier, or a host cron). Vercel Hobby cron is too infrequent and non-commercial.
- Locally: `pnpm jobs:tick` (`JOBS_NOW=2026-11-28T09:00:00Z` rehearses a date).
- Monitor: alert if the tick has not succeeded for 1 hour.

## 5. Deploy runbook

Before the first deploy (needs Owner approval for anything with cost, and for going live):
1. Create the database; create the private bucket; create the Stripe test-mode webhook endpoint `https://<APP_URL>/api/webhooks/stripe` (subscribe to the events the app handles; copy its signing secret).
2. Set every variable in section 2.
3. `pnpm install --frozen-lockfile && pnpm build`.
4. Apply migrations: `pnpm db:migrate` (the migrator refuses a database whose migration history doesn't match the journal; on a fresh database it applies everything from zero).
5. Create the first Owner: `pnpm owner:create`.
6. Start: `pnpm start`. Check `/api/health` returns 200.
7. Run the rate-limit check in the README (two steps from different networks).
8. Send a Stripe test event and confirm the webhook is accepted; replay the same event and confirm it is ignored (de-duplicated).
9. Trigger the scheduler once manually and confirm a 200 JSON result.

Releases: run `pnpm verify` on the release commit; take a backup (section 6); deploy; migrate; check health. Migrations are forward-only. A destructive one needs a documented rollback/backfill plan (`/create-migration`, CLAUDE.md rule 6). To roll back the app, redeploy the previous build; if a migration was applied, check its notes in `drizzle/NOTES.md` first, and restore from backup only as a last resort.

## 6. Backup and restore

What holds data: PostgreSQL (everything except documents) and the S3/R2 bucket (vaccination certificates, incident photos). Both are needed to restore. Invoices PDFs are generated on demand from the database.

Backups (provider choice and cost are undecided, so ask the Owner):
- Database: daily automated snapshot plus point-in-time recovery if the host offers it; keep at least 30 days. Also take a manual `pg_dump -Fc` before every migration. Store the dump somewhere other than the database host, encrypted.
- Bucket: enable object versioning or a scheduled copy to a second bucket. Retention rules still apply (D64): a backup must not keep data the retention job or an approved deletion has removed for longer than the agreed backup window. Record that window with the Owner.
- Secrets: keep `BETTER_AUTH_SECRET`, Stripe and S3 keys in the host's secret store and in the Owner's password manager; losing `BETTER_AUTH_SECRET` signs everyone out but loses no data.

Restore drill (do before go-live and then every quarter, into a throwaway database, never over production):
1. Create an empty database. `pg_restore --no-owner -d <new database> <dump>`.
2. Point a local or staging copy at it (`DATABASE_URL`), run `pnpm db:migrate` (should report nothing to do), then check `/api/health`.
3. Check: customer and dog counts, the newest invoice number is gap-free, a document opens from the restored bucket.
4. Record the date, the dump age (RPO) and the time taken (RTO) in `docs/progress.md`.

Real restore: put the site in maintenance (stop the app and scheduler), restore database and bucket to the same point in time, run migrations if the code is newer than the backup, start, check health, then run the scheduler once. Jobs and webhooks are idempotent, so the host re-sending recent Stripe events after a restore is safe; reconcile payments from the Stripe dashboard for the gap.
