/** Pure checks for scripts/restore-drill.ts, kept here so each refusal and check is unit-tested. */

/** Why a throwaway restore target is refused, or null if the name is acceptable. */
export function restoreTargetProblem(sourceDb: string, target: string): string | null {
  if (!/^[a-z0-9_]+$/.test(target)) return 'The target name may only use lowercase letters, digits and underscores.';
  if (!/(^|_)test(_|$)/.test(target))
    return 'The target database name must contain "test" (for example lunak9_restore_test).';
  if (target === sourceDb) return 'The target must not be the database you are restoring from.';
  return null;
}

/** The drill never overwrites: a target that already has tables is refused. */
export function existingTablesProblem(target: string, tableCount: number): string | null {
  return tableCount > 0
    ? `${target} already has tables. Pick another --target, or remove that throwaway database yourself first; this script never overwrites.`
    : null;
}

export function missingDumpProblem(path: string, exists: boolean): string | null {
  return exists ? null : `No dump at ${path}.`;
}

export function migrationCountProblem(applied: number, inCode: number): string | null {
  return applied === inCode
    ? null
    : `Migrations: the dump has ${applied} applied, the code has ${inCode}. Run pnpm db:migrate against the restored copy before using it.`;
}

/**
 * Invoice numbers are gap-free under one prefix, so the count issued is one less than the next number to take
 * and the suffixes are exactly 1..N. Several prefixes only happen in test data, so the suffix check is skipped.
 */
export function invoiceNumberingCheck(numbers: string[], nextValue: number): { label: string; problem: string | null } {
  if (numbers.length !== nextValue - 1)
    return {
      label: 'COUNT MISMATCH',
      problem: `${numbers.length} numbered invoices but the sequence says ${nextValue - 1} were issued.`,
    };
  const prefixes = new Set(numbers.map((n) => n.replace(/\d+$/, '')));
  if (prefixes.size > 1) return { label: 'several prefixes (test data), suffix check skipped', problem: null };
  const seq = numbers.map((n) => Number(/(\d+)$/.exec(n)?.[1])).sort((a, b) => a - b);
  if (seq.some((n, i) => n !== i + 1)) return { label: 'GAPS', problem: 'Invoice numbers are not 1..N without gaps.' };
  return { label: 'gap-free', problem: null };
}
