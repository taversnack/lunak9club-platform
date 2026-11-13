# Staging rehearsal runbook (host-neutral)

Purpose: run the production shape once, end to end, on a throwaway environment, so go-live holds no first-time surprises. This is the "Staging rehearsal" and "Backup and restore drill" items of the Before go-live checklist in `docs/deployment.md`. It names no provider; the host, database and bucket are the Owner's choice and cost money, so each is approved before use (CLAUDE.md rule 8). **No real customer data, no live Stripe keys and no real customer email**: use fictional data, Stripe **test** keys and a mailbox you own or a mail-catching inbox.

Time: about half a day for the rehearsal, plus the drill.

## 1. What the environment needs

| Piece | Requirement |
|---|---|
| Container host or VPS | Runs the image from the repository `Dockerfile` (or `pnpm build` and `pnpm start` on a VPS). Node 22, about 1 GB of memory for the app. A separate small job (the tools image) for migrations. |
| Managed PostgreSQL 16 | EU region, TLS, automated backups on, point-in-time recovery if offered, a database created for staging only. |
| Private S3-compatible bucket | EU region, not public, a key limited to this bucket. |
| Domain and TLS | A staging hostname with a valid certificate (the reverse proxy or the host's load balancer terminates TLS). |
| Reverse proxy | Passes `X-Forwarded-For`; the app's port reachable only through it. |
| Scheduler caller | Anything that can `POST` an https address on a timer (host cron, a small cron machine, a systemd timer). |
| Mail | A mailbox you own, or the provider's sandbox. Click and open tracking OFF (it rewrites sign-in links). |
| Stripe | Test keys and a test-mode webhook endpoint (see `docs/stripe-test-run.md`). |

## 2. Settings (staging runs in production mode, so production's checks are exercised)

`APP_ENV=production` with every setting in `docs/deployment.md` section 2. Staging-specific:
- `APP_URL=https://<staging hostname>`.
- `EMAIL_TRANSPORT=smtp`, `EMAIL_SANDBOX=0`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_TLS` (`starttls` or `tls`), `SMTP_USER`, `SMTP_PASSWORD` (the provider's, for a mailbox you own).
- `PAYMENTS_DRIVER=stripe`, `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...` (test; live keys are refused unless production *and* live, so use test keys here).
- `STORAGE_DRIVER=s3` plus the four `S3_...` settings.
- `TRUSTED_PROXIES=<the proxy's address or subnet>` **or** `CLIENT_IP_HEADER=<header the edge always overwrites>`.
- `CRON_SECRET` (32+ characters) and `AUTH_RATE_LIMIT=on`.
- `SCANNER_MODE=off` unless the Owner has approved the scanner's memory.
- `ALLOW_REMOTE_DB` is **not** set for this: a managed database is not "local", and `pnpm db:migrate` refuses a non-local host unless the database name contains `test`. Name the staging database `lunak9_staging_test`; do not set the override.

## 3. Rehearsal steps

Record the result and the time of each step; a step that fails is a finding, not something to work around.

1. **Build** the image: `docker build -t lunak9-club .` and `docker build --target tools -t lunak9-club-tools .`
2. **Refusal check:** start the runtime image with only `APP_ENV=production` and a database address. Expect it to exit with "Refusing to start" naming the missing settings and **no secret values**.
3. **Migrate from zero** against the empty staging database with the tools image (`pnpm db:migrate`). Expect "Migrations applied." and, on a second run, nothing to do. Compare the number of applied migrations with the files in `drizzle/`.
4. **Create the first Owner:** `docker run --rm -it --env-file <env file> lunak9-club-tools pnpm owner:create`. `pnpm db:seed` must refuse here (production); try it once to confirm.
5. **Start** the runtime image behind the proxy with the full settings.
6. **TLS and headers:** `curl -sI https://<host>/` shows HTTP/2 or 1.1 over a valid certificate, `Strict-Transport-Security`, `X-Content-Type-Options`, and a `Content-Security-Policy` with a nonce. Plain `http://` redirects to https at the proxy.
7. **Health:** `curl -s https://<host>/api/health` returns 200 `{"status":"ok",...}`. Stop the database (or point to a wrong address) briefly and confirm 503 `degraded` with no detail, then restore.
8. **Client address and rate limit** (README, "Deploying: client addresses and rate limits"). From one machine, six wrong-password sign-ins in a minute end in `429`, even with a different made-up `X-Forwarded-For` each time. Straight afterwards, from a **different network** (a phone on mobile data), a wrong-password sign-in gives the normal error, not `429`. A `429` there means everyone shares one bucket: the proxy setting is wrong.
9. **Sign-in:** the Owner signs in (password), and a customer (create one in the Owner area) signs in by the emailed link. The received link must point at `https://<host>` (not a tracking domain) and work once only.
10. **Scheduler:** set the caller to every 10 minutes: `POST https://<host>/api/jobs/tick` with `Authorization: Bearer $CRON_SECRET` (read from a root-only file, not typed into the crontab). A call without the secret returns 404. Two calls in a row: the second does nothing again (jobs are idempotent). Watch the Owner area for 1 hour: ticks succeed. Stop the caller and confirm your "scheduler stalled" alert fires (`docs/deployment.md` section 8).
11. **Stripe test events:** run the scenarios in `docs/stripe-test-run.md` against the staging webhook endpoint. At minimum: a paid checkout, a replayed event (answered `duplicate: true`), and a stale or forged signature (400).
12. **Uploads:** a customer uploads a vaccination PDF; it appears in the private bucket under a random key; the Owner opens it (60-second signed link, audited); a second customer cannot.
13. **Email:** each of the sign-in, booking and invoice emails arrives, reads properly, and none contains personal details beyond what the template says.
14. **Logs:** the host's log view shows structured lines; search them for an email address, a dog's name and a password: none appear.

## 4. Backup and restore drill

1. Confirm the managed database's automated backup ran (the provider's console) and note the time.
2. Take a manual dump too: `pg_dump -Fc` to a location off the database host (encrypted).
3. Restore into a **throwaway** database (never over staging or production): `pg_restore --no-owner -d <throwaway> <dump>`.
4. Point a local or second instance at it, run `pnpm db:migrate` (nothing to do), check `/api/health` is 200, and check: customer and dog counts match staging, the newest invoice number is the expected one, a document opens from the bucket.
5. Record the dump's age (RPO) and the elapsed time (RTO) in `docs/progress.md`. Repeat quarterly.

## 5. Rollback rehearsal

1. Deploy the previous image (keep the last two tags). Start it with the same settings; `/api/health` must be 200.
2. If the new release applied a migration, read its row in `drizzle/NOTES.md` first. Most are additive and the previous image runs fine on the newer schema; only a documented rollback is ever run, and only as a last resort, after a fresh backup.
3. Restoring from backup is the last resort: stop the app and the scheduler, restore to the point before the release, start the previous image, check health, run one tick. Jobs and webhooks are idempotent, so repeated ticks and re-sent Stripe events after a restore are safe; reconcile payments for the gap from the Stripe dashboard.
4. Time the whole thing and record it.

## 6. Exit criteria and after

Done when every step above passed, or each failure is a recorded finding with an owner. Then:
- Tick the "Staging rehearsal" and "Backup and restore drill" items in the Before go-live checklist and record the date and results in `docs/progress.md`.
- Tear the staging environment down, or keep it for the next release; either way remove its Stripe test webhook, rotate or delete the staging keys, and delete any fictional data that is not needed.
- Costs were incurred only for what the Owner approved; list what was used so the real bill can be estimated.
