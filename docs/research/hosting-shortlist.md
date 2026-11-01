# Hosting shortlist: Node container plus managed EU Postgres (D107)

Author: Researcher agent. Pages fetched: **30 Oct 2026**. **Advice only, not a decision.** Stephen has not chosen a provider.

- **Prices are in USD, not GBP.** Whether VAT is included is **unchecked**.
- Several pricing pages are JavaScript-heavy and returned partial data. Anything not read from a page is marked **unverified**. Re-check every price on the live page before the Owner commits.
- Every paid item is a cost to flag to the Owner before use (CLAUDE.md non-negotiable 8). I signed up for nothing.

## 1. DigitalOcean: App Platform + Managed PostgreSQL

| Item | Finding | Source |
|---|---|---|
| Region | London (LON1) and Frankfurt (FRA1) both "Available" for dynamic apps and for managed PostgreSQL | https://docs.digitalocean.com/platform/regional-availability/ |
| App price | Shared containers $5/mo (1 vCPU, 512 MiB) and $10/mo (1 vCPU, 1 GiB) | https://www.digitalocean.com/pricing/app-platform |
| Database price | Smallest PostgreSQL Standard plan (1 vCPU, 1 GiB) $15.15/mo; storage 10-30 GiB at $0.215/GiB/mo. Not stated whether the minimum storage is included in $15.15 | https://www.digitalocean.com/pricing/managed-databases |
| Approx total | About $25-26/mo (about £20 at a rough rate; **unverified conversion**) | derived |
| Do not use | The $7 App Platform "development database" is not backed up by default | pricing page above |
| DPA | Re-read 30 Oct 2026 (last updated 14 Oct 2026). It applies to data protected by laws including those of the United Kingdom, and includes the EU SCCs and the ICO's UK Addendum, but only as the fallback if the EU-US Data Privacy Framework becomes unavailable. It does not name "UK GDPR" explicitly (it defines data protection law by reference to the EU GDPR). Have the Owner or a solicitor confirm this is sufficient | https://www.digitalocean.com/legal/data-processing-agreement |
| Backups | Daily, kept 7 days; restore to latest transaction or a chosen point in time; creates a **new** cluster; destroying a cluster destroys its backups | https://docs.digitalocean.com/products/databases/postgresql/how-to/restore-from-backups/ |
| Cron | Scheduled jobs: docs say the cron expression must run at a "minimum every 15 minutes" (re-checked 1 Nov 2026). **DigitalOcean's built-in scheduled job cannot meet D107 as written** (D107: "a scheduler calling `/api/jobs/tick` every 10 minutes"). Options: accept a 15-minute tick (an Owner decision amending D107; allowed by D57's 5-15 min and described as working in `docs/deployment.md` section 4, added by merged PR #99), or call the tick from an external scheduler | https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/ (fetched 1 Nov 2026) |
| Unverified | PITR window length; VAT | |

## 2. Render: web service + Render Postgres

| Item | Finding | Source |
|---|---|---|
| Region | Frankfurt available; **London not offered** (Oregon, Ohio, Virginia, Frankfurt, Singapore) | https://render.com/docs/regions |
| Plans | Web: 0.5 CPU/512 MB (starter), 1 CPU/2 GB (standard). Postgres from 256 MB up | https://render.com/docs/compute-plans |
| Prices | **Unverified**: the pricing page returned no figures | https://render.com/pricing |
| Backups | PITR 3 days on Hobby, 7 days on Pro; logical backups kept 7 days; restore creates a new instance to validate; free Postgres has no PITR or backups | https://render.com/docs/postgresql-backups |
| DPA | **Verified 1 Nov 2026** (page text, no PDF): the Render Data Processing Addendum defines "Standard Contractual Clauses" as the EU SCCs and the UK SCCs, and "UK SCCs" as the EU SCCs as amended by the UK Addendum. Section 6 says ex-UK transfers use the EU SCCs amended and completed by the UK Addendum, which is incorporated as **Exhibit D** ("International Data Transfer Addendum to the EU Commission Standard Contractual Clauses"). It defines ex-UK transfers by reference to the UK GDPR and the Data Protection Act 2018. The importer is Render Services, Inc. (San Francisco, US). No "last updated" date was visible in the page text. Have the Owner or a solicitor confirm this is sufficient | https://render.com/dpa (fetched 1 Nov 2026) |
| Cron | Render Cron Jobs take a standard cron expression; the docs give `*/10 * * * *` ("Every ten minutes") as an example, so a 10-minute tick is supported. Times are UTC. Minimum charge $1/month per cron job service (a paid item to flag) | https://render.com/docs/cronjobs (fetched 1 Nov 2026) |

## 3. Fly.io: Machines + Managed Postgres

| Item | Finding | Source |
|---|---|---|
| Machine price | shared-cpu-1x: $2.19 (256 MB), $3.69 (512 MB), $6.70 (1 GB) per month. These are the **cheapest US regions**; EU prices may differ | https://docs.fly.io/about/pricing |
| Database price | Managed Postgres Basic $38/mo (shared-2x, 1 GB), Starter $72/mo (2 GB); storage $0.28/GB/mo | https://docs.fly.io/mpg/overview |
| Approx total | About $45-50/mo (**unverified for EU regions**) | derived |
| Region | London / Frankfurt for Managed Postgres **unverified** (not listed on the pages fetched) | |
| Backups | Docs say automatic backups on all plans; retention period not stated. Volume snapshots: daily, 5 days by default, $0.08/GB beyond the first 10 GB | https://docs.fly.io/about/pricing |
| DPA | Page tried returned 404; **unverified** | |
| Cron | Built-in scheduled Machines (`--schedule`) run only on a fuzzy hourly, daily, weekly or monthly cycle, so they **cannot** meet a 10-minute tick. Fly's Supercronic guide runs a crontab inside the app container and shows a `*/5 * * * *` example, so a 10-minute tick is possible that way (our own process to run and monitor) | https://fly.io/docs/machines/flyctl/fly-machine-run/ and https://fly.io/docs/app-guides/supercronic/ (fetched 1 Nov 2026) |

## 4. Budget alternative (not managed Postgres): Hetzner Cloud VPS

- From EUR 5.99/mo (Cost-Optimized shared), excluding VAT as stated on the page. EU locations Falkenstein, Nuremberg (Germany) and Helsinki (Finland); **no London**. https://www.hetzner.com/cloud/
- I saw no managed Postgres on the pages fetched, so Postgres, backups and tested restores would be our own job. UK addendum on the DPA **unverified**.
- Tick: Hetzner has no managed scheduler; we would run cron or a systemd timer on the VPS ourselves, as in `docs/deployment.md` section 4 (`*/10 * * * *`). Hetzner documentation on this is **unverified** (not checked).

## 5. Comparison

| | DigitalOcean | Render | Fly.io | Hetzner VPS |
|---|---|---|---|---|
| UK region confirmed | Yes (London) | No (Frankfurt only) | Unverified | No |
| EU region confirmed | Yes | Yes | Unverified | Yes |
| Managed Postgres | Yes | Yes | Yes | No |
| Prices verified | Yes (USD) | No | Partly (US prices) | From-price only |
| DPA includes UK Addendum | Yes (as fallback; no explicit "UK GDPR" wording) | Yes (Exhibit D, verified 1 Nov 2026) | Unverified | Unverified |
| Built-in scheduler meets D107 10-min tick | **No** (15-min minimum) | Yes (`*/10` example) | No (hourly at best); Yes via Supercronic in-container | No built-in; own cron on the VPS (unverified in Hetzner docs) |
| Backup/restore documented | Yes (7 days, new cluster) | Yes (3 or 7 days PITR) | Partly | Self-managed |

## 6. Opinion (not a recommendation)

DigitalOcean London is the only option where I could confirm a UK region, a DPA that includes the UK Addendum (as a fallback) and a restore path, at roughly $25-26 a month. Render and Fly.io may be viable but need the unverified items above checked.

## 6a. Scheduler tick vs D107

D107 (docs/decisions.md, approved by Stephen, 30 Oct 2026) plans for "a scheduler calling `/api/jobs/tick` every 10 minutes with the bearer secret (D57)". D57 allows a tick "every 5–15 min". `docs/deployment.md` section 4 (merged PR #99) says: "10 minutes or less is preferred, but a 15-minute tick works", and every job runs up to one interval late (09:00 invoice send, 15:30 reminder, 08:00 and 17:00 reminders, lapsed payment holds, 23:59 booking-request cut-off).

| Host | Shortest tick from the host's own scheduler | Source |
|---|---|---|
| DigitalOcean App Platform | 15 minutes, so D107's 10 minutes is **not met** | https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/ |
| Render | Standard cron; `*/10` is a documented example, so 10 minutes is met. Shorter intervals are **unverified** | https://render.com/docs/cronjobs |
| Fly.io | Scheduled Machines: about hourly at best (not met). Supercronic in the container: `*/5` documented, so 10 minutes is met | https://fly.io/docs/machines/flyctl/fly-machine-run/, https://fly.io/docs/app-guides/supercronic/ |
| Hetzner VPS | No managed scheduler; OS cron on our own server. **Unverified** in Hetzner docs | |

## 6b. Related decisions

| Decision | Why it matters to hosting |
|---|---|
| D14 Hosting | Free tiers, UK/EU regions; paid items flagged to the Owner before they are needed (ADR 0001) |
| D28 Document storage | Production storage is Cloudflare R2 (EU) through the storage adapter, so the host needs outbound S3 access and no persistent disk for uploads |
| D29 Upload rules | Uploads up to 10 MB, never public, downloads through the app only, so the proxy/body limits must allow 10 MB |
| D30 Virus scanning | No scanning service yet; revisit before launch, which may need something added to the host |
| D33 Sensitive dog data | Never in logs, so host log retention and log drains must not capture it |
| D57 Scheduled jobs | One idempotent tick every 5–15 min; the host must provide or allow a scheduler |
| D64 Retention | Retention runs daily at 03:00; backups and log retention on the host should fit these periods |
| D65 UK GDPR data rights | Deletion and anonymisation; affects the DPA, the region and how long backups keep deleted data |
| D102 Email provider | No production email provider chosen; the host must not depend on one, and SMTP egress may matter later |
| D104 Hosting (Cloudflare) | Superseded by D107; its spike findings are kept as reference |
| D107 Hosting: container or VPS | The basis of this shortlist: Node container/VPS, managed EU/UK Postgres with backups and a tested restore, 10-minute tick, health check, no spend without Owner approval |

## 7. Before committing

Confirm: if DigitalOcean is chosen, whether the Owner amends D107 to accept a 15-minute tick or we use an external scheduler; PITR window, VAT, Postgres minimum storage cost, a tested restore (Phase 8), and that the tick endpoint stays authorised and idempotent (D57).

## 8. Self-check log (30 Oct 2026)

Re-fetched DigitalOcean app, database and DPA pages, the DigitalOcean jobs doc, and Fly.io pricing. Prices re-confirmed unchanged. Corrections made: DigitalOcean DPA wording softened (no explicit UK GDPR mention; UK Addendum is a fallback); DigitalOcean cron minimum is 15 minutes, not 10.

## 9. Tester fixes (1 Nov 2026)

Render DPA verified (UK Addendum is Exhibit D). Added D107 tick comparison per host with sources, and the related decisions above. DigitalOcean jobs doc re-checked.
