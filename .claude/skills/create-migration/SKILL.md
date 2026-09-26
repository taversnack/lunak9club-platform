---
name: create-migration
description: Generate and review a Drizzle SQL migration with data-impact notes, backfill and rollback considerations, tested on representative data.
---
1. Edit schema in `src/infra/db/schema/**`; run `pnpm db:generate --name <verb_noun>`.
2. Read the generated SQL. Check: constraints/indexes intended, no accidental drops/renames, locks on large tables, defaults for NOT NULL on existing rows.
3. Add to the migration folder a `NOTES.md` section: purpose, data impact, backfill steps, rollback/recovery plan, whether it is destructive.
4. Test: migrate from zero, and migrate a seeded DB from the previous version; run `pnpm test:int`.
5. Destructive changes (drop/rename/type change) need an expand → backfill → contract plan and Owner approval. Never run against production from here.
