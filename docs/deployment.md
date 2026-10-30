# Deployment, backup and environment reference

Status: **not deployed.** Hosting direction (Owner, D107): a **Node container or VPS with managed EU PostgreSQL**; not Cloudflare or Vercel. No provider is chosen or signed up for, and anything that costs money needs the Owner's approval first (CLAUDE.md rule 8). Source of truth for settings: `src/infra/env.ts` and `.env.example`.

## 1. Known gaps to close before go-live

1. **Outbound email has no SMTP login.** `src/infra/email/providers.ts` creates the SMTP transport with host, port and `secure: false` only. Production requires `EMAIL_TRANSPORT=smtp`, but a real mail provider needs a username, password and usually TLS. `RESEND_API_KEY` appears in `.env.example` but nothing reads it. This needs a small code change (SMTP user/password/secure settings, or a Resend adapter) and a provider choice (possible cost: Owner approval).
2. Which container host or VPS, which managed Postgres and which S3-compatible bucket: not chosen (all cost money; see section 7).
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
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | none | required with `s3` | Private bucket in an EU region; any S3-compatible provider (ADR 0001 named R2). |
| `S3_REGION` | eu-west-2 | optional | Provider's region name (R2 uses `auto`). |
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

Daily and monthly jobs (nightly membership drafts and book-ahead, month-end sends, reminders, hold expiry, retention, payment reconciliation) run from one tick endpoint: `POST /api/jobs/tick` with `Authorization: Bearer $CRON_SECRET`. A wrong or missing secret gives 404.

- Call it **every 10 minutes** (invoice sends are 09:00 and reminders 15:30 London time). Jobs are idempotent: unique run keys mean a repeated or overlapping call does nothing twice.
- On a VPS or container host, any scheduler on the same machine or network works, for example a crontab line (the secret read from a root-only file, never typed into the crontab):
  `*/10 * * * * curl -fsS -m 60 -X POST -H "Authorization: Bearer $(cat /etc/lunak9/cron-secret)" https://<APP_URL>/api/jobs/tick > /dev/null`
  or a systemd timer, or the container platform's scheduled-job feature. Call the public https address (through the proxy) or the app's internal address; either is fine.
- Locally: `pnpm jobs:tick` (`JOBS_NOW=2026-11-28T09:00:00Z` rehearses a date).
- Monitor: alert if the tick has not succeeded for 1 hour (`curl -f` fails on a non-2xx status, so cron mail or the timer's failure state can drive the alert).

## 5. Hosting shape and deploy runbook

**Shape (D107).** One Node 22 container (or a process on a VPS) running `next start` on port 3000, behind a reverse proxy that terminates TLS (Caddy, nginx or the host's load balancer), talking to a managed EU PostgreSQL 16 and an S3-compatible private bucket. The `Dockerfile` in the repository root builds two targets:

- `docker build -t lunak9-club .` : the runtime image (production dependencies, `.next`, migrations). Runs as the unprivileged `node` user. Needs the settings in section 2 at run time or it refuses to start; nothing is baked in (the build uses throwaway placeholder values for one command only). Checked locally: it builds, serves `/api/health` 200 against a migrated database, and a production start with unsafe settings refuses to start; the tools image applied all migrations to an empty database. Image sizes are about 1.5 GB; trim later if the host charges for storage.
- `docker build --target tools -t lunak9-club-tools .` : the full build image for one-off jobs: `pnpm db:migrate`, `pnpm owner:create`, `pnpm jobs:tick`.

**Reverse proxy and client addresses.** The proxy must pass `X-Forwarded-For` (Caddy and nginx `proxy_add_x_forwarded_for` do) and the app must only be reachable through it (firewall port 3000 to the proxy). Set `TRUSTED_PROXIES` to the proxy's address or subnet (for example the Docker network, `172.16.0.0/12`), or `CLIENT_IP_HEADER` to a header the proxy always overwrites (nginx `proxy_set_header X-Real-IP $remote_addr` then `CLIENT_IP_HEADER=x-real-ip`). Production refuses to start without one while the auth rate limit is on. See the README, "Deploying: client addresses and rate limits", and run its two-network check after deploying. The app already sends HSTS and the other security headers; keep the HTTP-to-HTTPS redirect at the proxy.

**Health check.** Point the container or proxy health check at `GET /api/health` (section 3). Restart on failure; alert on repeated 503.

**First deploy** (needs the Owner's approval for anything with cost, and for going live):
1. Create the managed Postgres (EU region, TLS, automated backups on, see section 6) and the private bucket. Create the Stripe test-mode webhook endpoint `https://<APP_URL>/api/webhooks/stripe` (events the app handles; keep its signing secret).
2. Put every variable from section 2 in the host's secret store or a root-only env file that is not in the repository.
3. Build: `docker build -t lunak9-club . && docker build --target tools -t lunak9-club-tools .` (or `pnpm install --frozen-lockfile && pnpm build` on a VPS).
4. Apply migrations with the tools image: `docker run --rm --env-file <env file> lunak9-club-tools pnpm db:migrate` (refuses a database whose migration history does not match the journal; on an empty database it applies everything from zero).
5. Create the first Owner: `docker run --rm -it --env-file <env file> lunak9-club-tools pnpm owner:create`.
6. Start the runtime image with the same env file and port 3000 published only to the proxy. Check `/api/health` returns 200.
7. Add the scheduler (section 4) and confirm one manual tick returns 200 JSON.
8. Run the rate-limit check in the README (two steps from different networks).
9. Send a Stripe test event and confirm it is accepted; replay it and confirm it is ignored (de-duplicated).

**Releases.** Run `pnpm verify` on the release commit; take a database backup (section 6); build; run migrations with the tools image; start the new container; check health; stop the old one. Migrations are forward-only. A destructive one needs a documented rollback/backfill plan (`/create-migration`, CLAUDE.md rule 6). To roll back the app, run the previous image; if a migration was applied, read its notes in `drizzle/NOTES.md` first, and restore from backup only as a last resort.

## 6. Backup and restore

What holds data: PostgreSQL (everything except documents) and the S3-compatible bucket (vaccination certificates, incident photos). Both are needed to restore. Invoices PDFs are generated on demand from the database.

Backups (provider choice and cost are undecided, so ask the Owner):
- Database: choose a managed Postgres whose automated daily backups and point-in-time recovery are on, kept at least 30 days; check the plan includes them (some cheaper tiers do not). Also take a manual `pg_dump -Fc` before every migration. Store the dump somewhere other than the database host, encrypted.
- Bucket: enable object versioning or a scheduled copy to a second bucket. Retention rules still apply (D64): a backup must not keep data the retention job or an approved deletion has removed for longer than the agreed backup window. Record that window with the Owner.
- Secrets: keep `BETTER_AUTH_SECRET`, Stripe and S3 keys in the host's secret store and in the Owner's password manager; losing `BETTER_AUTH_SECRET` signs everyone out but loses no data.

Restore drill (do before go-live and then every quarter, into a throwaway database, never over production):
1. Create an empty database. `pg_restore --no-owner -d <new database> <dump>`.
2. Point a local or staging copy at it (`DATABASE_URL`), run `pnpm db:migrate` (should report nothing to do), then check `/api/health`.
3. Check: customer and dog counts, the newest invoice number is gap-free, a document opens from the restored bucket.
4. Record the date, the dump age (RPO) and the time taken (RTO) in `docs/progress.md`.

Real restore: put the site in maintenance (stop the app and scheduler), restore database and bucket to the same point in time, run migrations if the code is newer than the backup, start, check health, then run the scheduler once. Jobs and webhooks are idempotent, so the host re-sending recent Stripe events after a restore is safe; reconcile payments from the Stripe dashboard for the gap.

## 7. Paid items and options considered

**Paid items (each needs the Owner's approval before use):** a VPS or container host; a managed EU PostgreSQL plan with backups and point-in-time recovery; an S3-compatible bucket for documents (ADR 0001 named Cloudflare R2's free tier, but any provider works with the `s3` driver; check current pricing and the EU region); a domain name (TLS certificates from Let's Encrypt are free); an uptime monitor if the free tier is too small; the email provider (D102).

**Options considered and not taken (Owner decision, D107):**
- *Cloudflare Workers via the OpenNext adapter* (spike, PR #86, closed): the Next.js build and OpenNext output worked, but the Worker bundle step failed resolving `pg-cloudflare` under pnpm (adding it as a direct dependency did not help); `nodemailer` (raw SMTP over TCP) does not run on Workers; the compressed Worker size was likely over the free plan limit, so the Workers Paid plan, plus Hyperdrive or a hosted Postgres, a domain and an email provider, would have been paid items. It would also have meant changing the database driver.
- *Vercel*: the free Hobby plan is non-commercial only and its cron runs too rarely for the 10-minute scheduler (O6, O12).
