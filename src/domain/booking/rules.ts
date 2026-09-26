import { addDays, daysBetween, type IsoDate } from '../time';

/** Pure booking rules (D35–D43). No I/O; all times are evaluated in Europe/London. */

export type Session = 'full' | 'am' | 'pm';
export type Settings = {
  sessionCapacity: number;
  taxiCapacity: number;
  openWeekdays: readonly number[];
  fullDayStart: string;
  morningStart: string;
  afternoonStart: string;
  fullDayEnd: string;
  morningEnd: string;
  afternoonEnd: string;
  maxAdvanceDays: number;
  freeCancellationHours: number;
  waitlistOfferHours: number;
};

export const SESSION_LABELS: Record<Session, string> = { full: 'Full day', am: 'Morning', pm: 'Afternoon' };

export function sessionTimes(s: Settings, session: Session): { start: string; end: string } {
  if (session === 'am') return { start: s.morningStart, end: s.morningEnd };
  if (session === 'pm') return { start: s.afternoonStart, end: s.afternoonEnd };
  return { start: s.fullDayStart, end: s.fullDayEnd };
}

/** ISO weekday (1 = Monday … 7 = Sunday) for a calendar date. */
export function isoWeekday(date: IsoDate): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The UTC instant of a London wall-clock time on a date (handles GMT/BST). */
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

export type DateCheck = { ok: true } | { ok: false; reason: string };

/** Can a customer still book this date? Until 23:59 the day before, up to maxAdvanceDays ahead, when open. */
export function checkBookableDate(input: {
  date: IsoDate;
  today: IsoDate;
  settings: Settings;
  closedReason?: string | null;
}): DateCheck {
  const { date, today, settings } = input;
  if (date <= today) return { ok: false, reason: 'Bookings close at 23:59 the day before.' };
  if (daysBetween(today, date) > settings.maxAdvanceDays) {
    return { ok: false, reason: `You can book up to ${settings.maxAdvanceDays} days ahead.` };
  }
  if (!settings.openWeekdays.includes(isoWeekday(date))) return { ok: false, reason: 'We’re closed on this day.' };
  if (input.closedReason) return { ok: false, reason: `Closed: ${input.closedReason}` };
  return { ok: true };
}

export type UsageRow = { session: Session; taxi: boolean; status: string; offerExpiresAt: Date | null };

/** Places in use on a date. Live offers hold a place until they expire. */
export function usage(rows: readonly UsageRow[], now: Date): { am: number; pm: number; taxi: number } {
  let am = 0;
  let pm = 0;
  let taxi = 0;
  for (const r of rows) {
    const holds =
      r.status === 'confirmed' ||
      r.status === 'attended' ||
      r.status === 'no_show' ||
      (r.status === 'offered' && r.offerExpiresAt !== null && r.offerExpiresAt > now);
    if (!holds) continue;
    if (r.session !== 'pm') am++;
    if (r.session !== 'am') pm++;
    if (r.taxi) taxi++;
  }
  return { am, pm, taxi };
}

export type Capacity = { session: number; taxi: number };

export function remainingFor(session: Session, used: { am: number; pm: number }, cap: Capacity): number {
  const amLeft = cap.session - used.am;
  const pmLeft = cap.session - used.pm;
  if (session === 'am') return amLeft;
  if (session === 'pm') return pmLeft;
  return Math.min(amLeft, pmLeft);
}

export function fits(
  session: Session,
  taxi: boolean,
  used: { am: number; pm: number; taxi: number },
  cap: Capacity,
  extra = 1,
): { ok: boolean; reason?: 'session_full' | 'taxi_full' } {
  if (remainingFor(session, used, cap) < extra) return { ok: false, reason: 'session_full' };
  if (taxi && cap.taxi - used.taxi < extra) return { ok: false, reason: 'taxi_full' };
  return { ok: true };
}

export type Availability = 'available' | 'nearly_full' | 'full' | 'closed';

export function availabilityLabel(remaining: number, closed: boolean): Availability {
  if (closed) return 'closed';
  if (remaining <= 0) return 'full';
  if (remaining <= 3) return 'nearly_full';
  return 'available';
}

/** Free cancellation if the session starts at least `freeCancellationHours` from now (D39). */
export function cancellationTerms(
  now: Date,
  date: IsoDate,
  session: Session,
  s: Settings,
): { late: boolean; deadline: Date } {
  const start = londonInstant(date, sessionTimes(s, session).start);
  const deadline = new Date(start.getTime() - s.freeCancellationHours * 3_600_000);
  return { late: now >= deadline, deadline };
}

export type VaccinationFact = { label: string; expiresOn: IsoDate | null; mandatory: boolean; blocksBooking: boolean };

/** D40: a mandatory vaccination must still be valid on the booked date. */
export function vaccinationBlockForDate(vaccinations: readonly VaccinationFact[], date: IsoDate): string | null {
  for (const v of vaccinations) {
    if (!v.mandatory || !v.blocksBooking) continue;
    if (!v.expiresOn) return `${v.label} is missing.`;
    if (v.expiresOn < date) return `${v.label} runs out before this date.`;
  }
  return null;
}

/** D43: interim estimate in pence at the ad hoc rate until the pricing engine lands. */
export function estimatePence(session: Session, dogCount: number, dateCount: number): number {
  return (session === 'full' ? 5000 : 2500) * dogCount * dateCount;
}

export function formatPounds(pence: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

/** Dates shown on the booking calendar: from tomorrow for `days` days. */
export function calendarDates(today: IsoDate, days: number): IsoDate[] {
  return Array.from({ length: days }, (_, i) => addDays(today, i + 1));
}
