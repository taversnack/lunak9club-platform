/**
 * Drizzle's migrator only applies journal entries newer than the newest migration already recorded
 * in drizzle.__drizzle_migrations. A database migrated with a broken journal (e.g. one built at
 * 06b76a9 or 0ff11e4, before the chain was repaired) can therefore have a migration recorded that
 * the journal no longer has, or be missing an older one the migrator would silently skip. Either
 * way, migrating "succeeds" and leaves a schema that doesn't match the code. Refuse instead.
 */
export type JournalEntry = { tag: string; when: number };

const HOW_TO_FIX =
  'This database was migrated with an older, broken migration journal and cannot be upgraded safely. ' +
  'Recreate it: drop and create the database, then run `pnpm db:migrate` (for local dev, `pnpm db:reset`). ' +
  'For a database with data you need to keep, stop and ask a developer to repair it by hand.';

export function migrationStateProblem(journal: JournalEntry[], appliedCreatedAt: number[]): string | null {
  if (!appliedCreatedAt.length) return null;
  const known = new Set(journal.map((e) => e.when));
  const unknown = appliedCreatedAt.filter((t) => !known.has(t));
  if (unknown.length)
    return `Refusing to migrate: the database records ${unknown.length} migration(s) that aren't in drizzle/meta/_journal.json (created_at ${unknown.join(', ')}). ${HOW_TO_FIX}`;
  const applied = new Set(appliedCreatedAt);
  const latest = Math.max(...appliedCreatedAt);
  const skipped = journal.filter((e) => e.when < latest && !applied.has(e.when));
  if (skipped.length)
    return `Refusing to migrate: ${skipped.map((e) => e.tag).join(', ')} ${skipped.length === 1 ? 'is' : 'are'} older than the latest applied migration but not applied, so they would be skipped. ${HOW_TO_FIX}`;
  return null;
}
