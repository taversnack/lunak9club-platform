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
| Cron | Scheduled jobs: docs say the expression must run "minimum every 15 minutes", so a 10-minute tick is **not possible**; a 15-minute tick is. Check D57 (jobs run on a 5-15 minute tick) is satisfied, notably the 15:30 reminder | https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/ |
| Unverified | PITR window length; VAT | |

## 2. Render: web service + Render Postgres

| Item | Finding | Source |
|---|---|---|
| Region | Frankfurt available; **London not offered** (Oregon, Ohio, Virginia, Frankfurt, Singapore) | https://render.com/docs/regions |
| Plans | Web: 0.5 CPU/512 MB (starter), 1 CPU/2 GB (standard). Postgres from 256 MB up | https://render.com/docs/compute-plans |
| Prices | **Unverified**: the pricing page returned no figures | https://render.com/pricing |
| Backups | PITR 3 days on Hobby, 7 days on Pro; logical backups kept 7 days; restore creates a new instance to validate; free Postgres has no PITR or backups | https://render.com/docs/postgresql-backups |
| DPA | A DPA page exists; SCCs / UK addendum **unverified** | https://render.com/dpa |

## 3. Fly.io: Machines + Managed Postgres

| Item | Finding | Source |
|---|---|---|
| Machine price | shared-cpu-1x: $2.19 (256 MB), $3.69 (512 MB), $6.70 (1 GB) per month. These are the **cheapest US regions**; EU prices may differ | https://docs.fly.io/about/pricing |
| Database price | Managed Postgres Basic $38/mo (shared-2x, 1 GB), Starter $72/mo (2 GB); storage $0.28/GB/mo | https://docs.fly.io/mpg/overview |
| Approx total | About $45-50/mo (**unverified for EU regions**) | derived |
| Region | London / Frankfurt for Managed Postgres **unverified** (not listed on the pages fetched) | |
| Backups | Docs say automatic backups on all plans; retention period not stated. Volume snapshots: daily, 5 days by default, $0.08/GB beyond the first 10 GB | https://docs.fly.io/about/pricing |
| DPA | Page tried returned 404; **unverified** | |

## 4. Budget alternative (not managed Postgres): Hetzner Cloud VPS

- From EUR 5.99/mo (Cost-Optimized shared), excluding VAT as stated on the page. EU locations Falkenstein, Nuremberg (Germany) and Helsinki (Finland); **no London**. https://www.hetzner.com/cloud/
- I saw no managed Postgres on the pages fetched, so Postgres, backups and tested restores would be our own job. UK addendum on the DPA **unverified**.

## 5. Comparison

| | DigitalOcean | Render | Fly.io | Hetzner VPS |
|---|---|---|---|---|
| UK region confirmed | Yes (London) | No (Frankfurt only) | Unverified | No |
| EU region confirmed | Yes | Yes | Unverified | Yes |
| Managed Postgres | Yes | Yes | Yes | No |
| Prices verified | Yes (USD) | No | Partly (US prices) | From-price only |
| DPA includes UK Addendum | Yes (as fallback; no explicit "UK GDPR" wording) | Unverified | Unverified | Unverified |
| Backup/restore documented | Yes (7 days, new cluster) | Yes (3 or 7 days PITR) | Partly | Self-managed |

## 6. Opinion (not a recommendation)

DigitalOcean London is the only option where I could confirm a UK region, a DPA that includes the UK Addendum (as a fallback) and a restore path, at roughly $25-26 a month. Render and Fly.io may be viable but need the unverified items above checked.

## 7. Before committing

Confirm: that a 15-minute tick (DigitalOcean's minimum) is acceptable, PITR window, VAT, Postgres minimum storage cost, a tested restore (Phase 8), and that the tick endpoint stays authorised and idempotent (D57).

## 8. Self-check log (30 Oct 2026)

Re-fetched DigitalOcean app, database and DPA pages, the DigitalOcean jobs doc, and Fly.io pricing. Prices re-confirmed unchanged. Corrections made: DigitalOcean DPA wording softened (no explicit UK GDPR mention; UK Addendum is a fallback); DigitalOcean cron minimum is 15 minutes, not 10.
