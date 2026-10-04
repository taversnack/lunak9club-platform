/** Calendar dates are ISO strings (YYYY-MM-DD) interpreted in Europe/London. */
export type IsoDate = string;

const LONDON = 'Europe/London';

export function londonDate(instant: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: LONDON,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, p) => ((acc[p.type] = p.value), acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function formatUkDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** The instant at which the Europe/London wall clock shows `date` `hh:mm` (handles BST/GMT). */
export function londonInstant(date: IsoDate, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const guess = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const offsetFor = (instant: Date) => {
    const tz = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((p) => p.type === 'timeZoneName')?.value;
    const match = tz?.match(/GMT([+-])(\d{2}):(\d{2})/);
    return match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  };
  // London is UTC+0 or UTC+1; one correction step is enough, a second handles the changeover edge.
  let instant = new Date(guess.getTime() - offsetFor(guess) * 60_000);
  instant = new Date(guess.getTime() - offsetFor(instant) * 60_000);
  return instant;
}

/** HH:MM on the Europe/London clock. */
export function londonTime(instant: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
}
