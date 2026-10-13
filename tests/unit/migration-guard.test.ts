import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { migrationStateProblem, type JournalEntry } from '@/infra/db/migration-guard';

const journal: JournalEntry[] = [
  { tag: '0000_init', when: 100 },
  { tag: '0001_roles', when: 200 },
  { tag: '0002_billing', when: 300 },
  { tag: '0003_refunds', when: 400 },
];

describe('migration guard', () => {
  it('lets a fresh, partly migrated or fully migrated database through', () => {
    expect(migrationStateProblem(journal, [])).toBeNull();
    expect(migrationStateProblem(journal, [100, 200])).toBeNull();
    expect(migrationStateProblem(journal, [100, 200, 300, 400])).toBeNull();
  });

  it('refuses a database that records a migration the journal does not have (e.g. stuck at 06b76a9 / 0ff11e4)', () => {
    const msg = migrationStateProblem(journal, [100, 200, 350]);
    expect(msg).toMatch(/Refusing to migrate.*aren't in drizzle\/meta\/_journal\.json.*350/);
    expect(msg).toMatch(/drop and create the database, then run `pnpm db:migrate`/);
  });

  it('refuses when an older journal entry was never applied, because drizzle would skip it', () => {
    const msg = migrationStateProblem(journal, [100, 200, 400]);
    expect(msg).toMatch(/0002_billing is older than the latest applied migration but not applied/);
    expect(msg).toMatch(/Recreate it/);
  });

  it('the real journal is consistent with itself', () => {
    const real = (JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: JournalEntry[] })
      .entries;
    expect(
      migrationStateProblem(
        real,
        real.map((e) => e.when),
      ),
    ).toBeNull();
  });
});
