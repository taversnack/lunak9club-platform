import 'server-only';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { bookingDogs, bookingSettings, closures, serviceDays } from '@/infra/db/schema';
import { usage, type Capacity, type Settings } from '@/domain/booking/rules';
import { formatUkDate, type IsoDate } from '@/domain/time';
import { SESSION_LABELS, type Session } from '@/domain/booking/rules';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

export async function loadSettings(db: Q): Promise<Settings> {
  const [row] = await db.select().from(bookingSettings).where(eq(bookingSettings.id, 1));
  if (!row) throw new Error('booking_settings row missing – run migrations');
  return row;
}

export async function closuresBetween(db: Q, from: IsoDate, to: IsoDate): Promise<Map<IsoDate, string>> {
  const rows = await db
    .select()
    .from(closures)
    .where(and(gte(closures.serviceDate, from), lte(closures.serviceDate, to)))
    .orderBy(asc(closures.serviceDate));
  return new Map(rows.map((r) => [r.serviceDate, r.reason]));
}

export function capacityFor(
  settings: Settings,
  day?: { sessionCapacity: number | null; taxiCapacity: number | null },
): Capacity {
  return {
    session: day?.sessionCapacity ?? settings.sessionCapacity,
    taxi: day?.taxiCapacity ?? settings.taxiCapacity,
  };
}

/** Usage and capacity for a set of dates, for display (no locking). */
export async function daysOverview(db: Q, dates: IsoDate[], settings: Settings, now = new Date()) {
  if (!dates.length)
    return new Map<IsoDate, { used: { am: number; pm: number; taxi: number }; cap: Capacity; waitlist: number }>();
  const [dayRows, rows] = await Promise.all([
    db.select().from(serviceDays).where(inArray(serviceDays.serviceDate, dates)),
    db
      .select({
        serviceDate: bookingDogs.serviceDate,
        session: bookingDogs.session,
        taxi: bookingDogs.taxi,
        status: bookingDogs.status,
        offerExpiresAt: bookingDogs.offerExpiresAt,
      })
      .from(bookingDogs)
      .where(
        and(
          inArray(bookingDogs.serviceDate, dates),
          inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'attended', 'no_show', 'offered', 'waitlisted']),
        ),
      ),
  ]);
  const days = new Map(dayRows.map((d) => [d.serviceDate, d]));
  const out = new Map<IsoDate, { used: { am: number; pm: number; taxi: number }; cap: Capacity; waitlist: number }>();
  for (const d of dates) {
    const mine = rows.filter((r) => r.serviceDate === d);
    out.set(d, {
      used: usage(mine, now),
      cap: capacityFor(settings, days.get(d)),
      waitlist: mine.filter((r) => r.status === 'waitlisted').length,
    });
  }
  return out;
}

/**
 * Create (if needed) and lock the service_day rows for these dates, in date order to avoid
 * deadlocks, then return live usage. Must be called inside a transaction.
 */
export async function lockDays(tx: Tx, dates: IsoDate[], settings: Settings, now = new Date()) {
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) return new Map();
  await tx
    .insert(serviceDays)
    .values(sorted.map((d) => ({ serviceDate: d })))
    .onConflictDoNothing();
  const locked = await tx
    .select()
    .from(serviceDays)
    .where(inArray(serviceDays.serviceDate, sorted))
    .orderBy(asc(serviceDays.serviceDate))
    .for('update');
  const rows = await tx
    .select({
      serviceDate: bookingDogs.serviceDate,
      session: bookingDogs.session,
      taxi: bookingDogs.taxi,
      status: bookingDogs.status,
      offerExpiresAt: bookingDogs.offerExpiresAt,
    })
    .from(bookingDogs)
    .where(
      and(
        inArray(bookingDogs.serviceDate, sorted),
        inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'attended', 'no_show', 'offered']),
      ),
    );
  const out = new Map<IsoDate, { used: { am: number; pm: number; taxi: number }; cap: Capacity }>();
  for (const d of locked) {
    out.set(d.serviceDate, {
      used: usage(
        rows.filter((r) => r.serviceDate === d.serviceDate),
        now,
      ),
      cap: capacityFor(settings, d),
    });
  }
  return out;
}

export function consume(used: { am: number; pm: number; taxi: number }, session: Session, taxi: boolean) {
  if (session !== 'pm') used.am++;
  if (session !== 'am') used.pm++;
  if (taxi) used.taxi++;
}

export const describeSession = (date: IsoDate, session: Session) => ({
  dateText: formatUkDate(date),
  sessionText: SESSION_LABELS[session],
});
