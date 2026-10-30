# Cloudflare deployment plan (spike)

Status: **plan and spike only. Nothing deployed, no Cloudflare account created, nothing paid for.** Decided by the Owner: Cloudflare for now (O6, O12). Anything marked **PAID?** must go to the Owner before use (CLAUDE.md rule 8).

## 1. Shape

- **App:** Next.js 16.4.1 built with the OpenNext Cloudflare adapter (`@opennextjs/cloudflare` 1.20.14, peer range `next >=16.4.1`, wrangler `^4.148`) and run as a Worker with `nodejs_compat`.
- **Database:** PostgreSQL (unchanged). Workers cannot hold a pool of TCP connections between requests, so connect through Cloudflare **Hyperdrive** or a Postgres host with a pooler. **PAID?** Hyperdrive has a free plan at the time of writing, but check current limits and the Workers plan it needs before relying on it. A hosted Postgres (Neon, Supabase, etc.) is a separate cost and is not decided.
- **Files:** Cloudflare R2, EU jurisdiction (ADR 0001). The existing S3 adapter (`STORAGE_DRIVER=s3`) already works with R2. Free tier exists; check limits.
- **Scheduler:** a Workers **Cron Trigger** `*/10 * * * *` (in `wrangler.jsonc`, spike branch) calling `POST /api/jobs/tick` with `Authorization: Bearer $CRON_SECRET`. Free. Needs a small `scheduled()` handler that adds a custom entry around the OpenNext worker (not written yet) and a `CRON_SECRET` Worker secret. Jobs are already idempotent, so double runs are safe.
- **Secrets:** `wrangler secret put` per variable in `docs/deployment.md` section 2 (never in `wrangler.jsonc`). Non-secret settings (`APP_ENV`, `APP_URL`, ...) go in `vars`.
- **Health:** `GET /api/health` for the uptime monitor and a post-deploy check; Cloudflare Health Checks/Load Balancing are paid, so use an external monitor or a free uptime service.
- **Client IP / rate limits:** set `CLIENT_IP_HEADER=cf-connecting-ip` (the app refuses to start in production otherwise). Cloudflare overwrites that header; the Worker must only be reachable through Cloudflare (use the workers.dev or the custom domain route, not a direct origin).
- **Domain:** a custom domain on Cloudflare needs the domain registered or transferred. **PAID?** Registration costs money. `*.workers.dev` is free but not suitable for a customer-facing business.

## 2. What the spike found (built locally, no account)

Branch `backend/cloudflare-spike`: adds `open-next.config.ts`, `wrangler.jsonc` and dev dependencies, then ran `opennextjs-cloudflare build`.

- **Next.js build and OpenNext output: works** (the app compiles, OpenNext produces a ~35 MB server-function directory).
- **Worker bundle step: fails** with `Could not resolve "pg-cloudflare"` from `pg@8.23.0/lib/stream.js`. `pg` loads `pg-cloudflare` for sockets on Workers, but under pnpm's layout the module is not found inside the copied `.open-next` tree, and adding `pg-cloudflare` as a direct dependency did not fix it. Not solved in the spike. Options to try next:
  1. Hyperdrive with `pg` and a pnpm `public-hoist-pattern[]=pg-cloudflare` (or `node-linker=hoisted`) so the module is resolvable.
  2. Swap `pg` for the `postgres` (porsager) driver, which supports Workers, through Drizzle's `postgres-js` adapter. This touches `src/infra/db` and every test setup, so it is a deliberate change needing its own PR and the full integration suite.
  3. Use Cloudflare's `cloudflare:sockets` support via `pg-cloudflare` explicitly marked external and provided by wrangler.
- **Other things that will not run on Workers as written** (not built yet, listed from reading the code):
  - `nodemailer` (SMTP over raw TCP) and no email provider is chosen. Production email is already a documented pre-launch blocker (`docs/deployment.md`). If the Owner later picks an HTTP email API, it also removes this problem.
  - `src/infra/storage/fs.ts` is development only; production uses S3/R2 (fine).
  - `pdf-lib` (pure JS) should work; `pino` logging is marked `serverExternalPackages` and needs checking on Workers.
  - `node:crypto` is available with `nodejs_compat`.
- **Size and limits (PAID?):** Workers Free caps the compressed Worker size at 3 MiB; Paid raises it to 10 MiB. A Next.js app with Better Auth, Stripe, the AWS S3 SDK and pdf-lib will probably exceed the free limit. Free also has a 10 ms CPU limit per request, which server-rendered pages with database access may hit. **The Workers Paid plan (about $5 a month at the time of writing; confirm on Cloudflare's pricing page) is likely required. This needs the Owner's approval before any use.** I have not measured the gzip size because the bundle step did not complete.

## 3. Next steps (in order, each its own PR)

1. Fix the `pg` bundling (option 1, then option 2 if needed), measure bundle size.
2. Add the scheduled handler for the cron trigger plus a test of the bearer check.
3. `wrangler dev` locally against the Docker Postgres to smoke-test sign-in, a booking and `/api/health`.
4. Owner decisions: Workers plan, Hyperdrive or hosted Postgres, domain, email provider.
5. Staging deploy only after the Owner approves the costs. Production only with explicit approval (CLAUDE.md rule 7).

## 4. Rollback

The spike changes no runtime code and no migration. Delete `open-next.config.ts`, `wrangler.jsonc` and the two dev dependencies to remove it. The existing Node deployment path is unaffected.
