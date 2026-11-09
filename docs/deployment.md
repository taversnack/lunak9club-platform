# Deployment, backup and environment reference

Status: **not deployed.** Hosting direction (Owner, D107): a **Node container or VPS with managed EU PostgreSQL**; not Cloudflare or Vercel. No provider is chosen or signed up for, and anything that costs money needs the Owner's approval first (CLAUDE.md rule 8). Source of truth for settings: `src/infra/env.ts` and `.env.example`.

## 1. Known gaps to close before go-live

1. **No production email provider is chosen (D102).** The SMTP transport is provider-neutral and production-capable: set `EMAIL_TRANSPORT=smtp`, `EMAIL_SANDBOX=0`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS` (`starttls` or `tls`), `SMTP_USER` and `SMTP_PASSWORD`; production refuses to start without them. What is missing is the Owner's choice of a provider (it may cost money, so ask first), a verified sender domain for `EMAIL_FROM`, and a real test send from a safe address. **Whichever provider is chosen, switch its click tracking and open tracking OFF**: sign-in links (D99) and invoice, pay and reset links must reach the customer exactly as we wrote them, and tracking rewrites every link through the provider's own address, which breaks the one-time links. Until then email stays local-only (Mailpit).
2. Which container host or VPS, which managed Postgres and which S3-compatible bucket: not chosen (all cost money; see section 7).
3. Virus scanning of uploads (D30, D109) is built in parts and is **off by default** (`SCANNER_MODE=off`). **Do not switch it on (`SCANNER_MODE=clamav`) until parts 2 and 3 are both merged and Stephen has approved the extra memory** (about 2 GB for the scanner container, a paid host-size item). Part 3 (the Owner's warning, acknowledgement and `document.opened_unscanned` audit entry for a held file) must be merged first. An infected upload is refused outright with no file kept (recorded in D109). See `docs/virus-scanning-options.md`.

## Before go-live checklist

Nothing here may be done with real customer data, live keys or real email until the Owner has approved that step in the conversation (CLAUDE.md rule 7). Tick each box when it is done and write the date in `docs/progress.md`.

- [ ] **Stripe test-mode run.** A real checkout, webhook delivery and refund end to end with Stripe's **test** keys (the simulated provider and the signature tests are not a substitute). Live keys only with the Owner's explicit approval.
- [ ] **Email provider and sender domain (D102).** The Owner chooses a provider; the sender domain is verified with **SPF and DKIM** (and DMARC) so mail is not marked as spam; a real test send to a safe address works; **click and open tracking are switched off at the provider** (otherwise it rewrites the magic links, D99, and the pay and reset links) and the received sign-in link is checked to point at our own address; bounces and complaints reach someone.
- [ ] **Staging rehearsal.** The container (or VPS) runs behind TLS with the proxy settings (`TRUSTED_PROXIES` or `CLIENT_IP_HEADER`) and the README two-network rate-limit check passes; `/api/health` is 200; the scheduler ticks every 10 to 15 minutes; migrations apply from zero; a Stripe test event is accepted and a replay is ignored.
- [ ] **Backup and restore drill** (section 6) done once into a throwaway database, with the date, dump age and time taken recorded.
- [ ] **Alerting configured** (section 8): uptime check on `/api/health`, scheduler-stalled alert, backup-age alert, database alerts, and a tested path to the Owner and a technical contact.
- [ ] **Seed never run in production.** `pnpm db:seed` and `pnpm db:reset` now refuse to run when `APP_ENV` or `NODE_ENV` is `production` (also in the tools image, which sets `NODE_ENV=production`). Do not work around this. The demo data is fictional and is for local development only.
- [ ] **First Owner created** with `pnpm owner:create` (see the runbook, step 5), signing in by the emailed link and setting a password.
- [ ] **Business details filled in** in the Owner area under Settings, Business (registered company name, company number, registered office and the other details the law expects on an invoice). An invoice cannot be approved until they are complete.
- [ ] **Bank holidays.** Closures for England and Wales bank holidays are loaded by migrations up to **31 December 2031**. A unit test (`tests/unit/bank-holidays.test.ts`) starts failing a year before the list ends, as the reminder to add the next years' dates in a new migration from <https://www.gov.uk/bank-holidays>. Do not ignore it: after the last date, bank holidays would become bookable.
- [ ] **Security and dependencies.** `pnpm audit --prod` shows no high or critical advisory and `/security-review` has been re-run on the release commit.
- [ ] **Virus scanning decision (D30).** `SCANNER_MODE` stays `off` unless Stephen has approved the extra memory (about 2 GB) and D30 part 3 is merged.
- [ ] **Open business questions answered**, for example approving a booking request in the minutes between the 23:59 cut-off and the first tick after midnight.

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
| `SMTP_HOST` / `SMTP_PORT` | localhost / 1025 | set; host must not be local | Your provider's SMTP host and port. |
| `SMTP_TLS` | off | `starttls` or `tls` | `starttls` usually port 587, `tls` port 465. |
| `SMTP_USER` / `SMTP_PASSWORD` | none | required, set together | Never logged. Keep in the secret store. |
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
| `SCANNER_MODE` | off | keep `off` until approved | `off` or `clamav`. Do not switch on before D30 part 3 is merged and Stephen has approved the memory cost (about 2 GB). |
| `SCANNER_HOST` / `SCANNER_PORT` | localhost / 3310 | the scanner container's address, used only with `clamav` | The clamd sidecar, reachable on the private network only. |
| `CRON_SECRET` | none | required, 32+ chars | Bearer token for `/api/jobs/tick`; the scheduler is off without it. |
| `LOG_LEVEL` | info | optional | fatal, error, warn, info, debug. |
| `TEST_DATABASE_URL`, `E2E_*` | n/a | not used | Test tooling only. |

Never commit real values. Secrets live in the host's secret store.

## 3. Health endpoint

`GET /api/health` (no login). Returns `200 {"status":"ok","checks":{"database":"ok","migrations":"ok"}}`. Returns `503 {"status":"degraded"}` if the database is unreachable, migrations are pending, or the environment configuration is invalid. `migrations: "unknown"` means the migration journal isn't shipped with the build (still 200). No settings, errors or personal data are exposed. Use it for the host's health check and uptime monitor.

## 4. Scheduler (O12)

Daily and monthly jobs (nightly membership drafts and book-ahead, month-end sends, reminders, hold expiry, retention, payment reconciliation) run from one tick endpoint: `POST /api/jobs/tick` with `Authorization: Bearer $CRON_SECRET`. A wrong or missing secret gives 404.

- Call it **every 10 minutes** (invoice sends are 09:00 and reminders 15:30 London time). Jobs are idempotent: unique run keys mean a repeated or overlapping call does nothing twice.
- Tick interval: 10 minutes or less is preferred, but a 15-minute tick works. Every job runs at the first tick at or after its time (once only), so at worst a job runs up to one interval late: the 09:00 invoice send, the 15:30 reminder, the 08:00 and 17:00 reminders and lapsed payment holds. The booking-request cut-off (23:59 the day before) closes requests at the first tick after midnight, so up to one interval late.
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
4. Apply migrations with the tools image: `docker run --rm --env-file <env file> lunak9-club-tools pnpm db:migrate` (refuses a database whose migration history does not match the journal; on an empty database it applies everything from zero). The scripts also refuse a database host that is not local unless the database name contains `test`, so against a real managed database this step stops with "Refusing to run against non-local database host". Setting `ALLOW_REMOTE_DB=yes-i-have-owner-approval` for that one command overrides the guard: **set it only with the Owner's explicit approval** (CLAUDE.md rule 7), never in the saved env file, and never for a staging copy of production data.
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

## 8. Production alerting (operations note)

Status: recommendations only. No monitoring service is chosen or paid for; every tool named here is a generic category. Alerts must never carry personal, payment or medical data (CLAUDE.md rule 5): they say what failed and where to look, not who it concerned.

**What already exists in the app:**
- A job that fails (or a tick step that reports errors) emails the Owner once per job per day ("Scheduled job failed: ..."), and the job is retried on the next tick.
- Structured error logs (`level` 50) with personal fields redacted; messages carry the error name, not its text.
- `GET /api/health` returns 503 when the database is unreachable, migrations are pending, or the configuration is invalid.
- A production start with unsafe settings exits at once, so the host keeps the previous release.
- Failed card refunds and missing pay links are listed on the Owner's Refunds and Today screens.
- There is **no external error tracker** and no alert for "the scheduler stopped calling us". Both are covered below.

**Recommended alerts** (tell the Owner and one technical contact; test each path before go-live):

| What | Signal | Alert when |
|---|---|---|
| Site is down | An external uptime check on `GET /api/health` every 1 to 5 minutes (also checks TLS expiry) | 2 failures in a row (non-200 or timeout); certificate expires in under 14 days |
| Scheduler stalled | The scheduler's own exit status (`curl -f`) or a "last success" ping to a dead-man's-switch monitor | No successful tick for 30 minutes (two missed ticks at 15 minutes, three at 10) |
| A job keeps failing | The existing Owner email, plus `job failed` lines in the logs | Same job emails two days running (the email says so), or any `job failed` for retention or invoice jobs |
| Errors rising | Count of `level` 50 log lines, from the host or log tool | More than 10 in 5 minutes, or any burst after a deploy |
| Payments | Stripe's own dashboard alerts for a failing webhook endpoint (built in and free), and `webhook failed` log lines | Endpoint failing or more than 3 failures in an hour; refunds listed as failed for more than a day |
| Database | The managed Postgres provider's alerts | Disk over 80%, connections over 80%, CPU or memory sustained high, failed backup |
| Backups | Last successful backup time | Older than 26 hours; also a quarterly reminder to run the restore drill (section 6) |
| Container health | Restart count and memory | More than 3 restarts in 10 minutes, or memory over 85% |
| Email | The email provider's bounce and complaint notices once a provider is chosen (D102) | Any complaint, or bounces above 2% |
| Sign-in abuse | Count of 429 responses on sign-in routes (proxy logs) | A sustained burst from many addresses (information, not urgent) |

**Cheap ways to do this without choosing a paid tool:** the host's built-in metrics and alerts; a crontab on another machine that calls `/api/health` and mails on failure; a self-hosted or free-tier uptime and dead-man's-switch monitor (a paid plan only if the free limits are too small, which is a paid item for the Owner's approval); the managed database's included alerts. Adding an error-tracking service later is a dependency and a possible cost, so it needs the Owner's decision first.

**Housekeeping:** keep a one-page runbook ("what to check when this alert fires") next to the alert list; review the thresholds after the first month of real traffic; log retention follows D64 (technical data 90 days).

