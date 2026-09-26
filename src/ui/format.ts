const LONDON = 'Europe/London';

/** Format an instant for display in UK time, e.g. "26 Sept 2026, 14:05". */
export function formatDateTimeLondon(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: LONDON, dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
