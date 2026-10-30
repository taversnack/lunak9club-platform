import { describe, expect, it } from 'vitest';
import { pendingMigrations } from '@/infra/db/health';

describe('pendingMigrations', () => {
  const journal = [
    { tag: '0000_a', when: 1 },
    { tag: '0001_b', when: 2 },
  ];
  it('is empty when everything is applied', () => expect(pendingMigrations(journal, [1, 2])).toEqual([]));
  it('lists unapplied entries', () => expect(pendingMigrations(journal, [1]).map((e) => e.tag)).toEqual(['0001_b']));
  it('lists all for a never-migrated database', () => expect(pendingMigrations(journal, [])).toHaveLength(2));
});
