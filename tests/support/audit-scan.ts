const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Where audit metadata holds any of the given personal strings, as `action.key` (never the value, so
 * a failure can't itself print personal data). Ids are random UUIDs, which can contain a short run
 * such as 07700 by chance, so they are taken out before looking.
 */
export function auditLeaks(
  rows: { action: string; metadata: Record<string, unknown> | null }[],
  needles: string[],
): string[] {
  const hits: string[] = [];
  for (const row of rows)
    for (const [key, value] of Object.entries(row.metadata ?? {})) {
      const text = JSON.stringify(value).replace(UUID, '<id>');
      if (needles.some((n) => text.includes(n))) hits.push(`${row.action}.${key}`);
    }
  return hits;
}
