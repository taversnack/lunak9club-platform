import 'server-only';
import { and, eq, gt, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { bookingDogs, invoices, memberships } from '@/infra/db/schema';
import { checkBookableDate, fits, type Session } from '@/domain/booking/rules';
import { firstUninvoicedMonthStart, membershipDates } from '@/domain/membership/rules';
import { addDays, formatUkDate, londonDate, type IsoDate } from '@/domain/time';
import type { Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { closuresBetween, lockDays, loadSettings } from './booking-shared';
import { cancelDaysAfter, describeWeekdays, HORIZON_DAYS } from './memberships';

/**
 * Shared membership-days helpers for the D86–D90 workflow: the space check, the "next month that
 * hasn't been invoiced" start date, and starting or replacing a dog's membership. Used by the
 * Owner's direct changes, offer confirmation and the membership.days approval type.
 */

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

export type DaysPlan = { weekdays: number[]; session: Session; taxi: boolean };

export const SESSION_WORDS: Record<Session, string> = { full: 'full day', am: 'morning', pm: 'afternoon' };

/** "Mon, Wed – full day, from 2 Nov 2026" */
export const describePlan = (p: DaysPlan, startsOn: IsoDate) =>
  `${describeWeekdays(p.weekdays)} – ${SESSION_WORDS[p.session]}${p.taxi ? ' with taxi' : ''}, from ${formatUkDate(startsOn)}`;

/** D89: months already on a sent (or approved) membership invoice for this customer. */
export async function invoicedMonths(q: Q, customerId: string): Promise<string[]> {
  const rows = await q
    .select({ month: invoices.periodMonth })
    .from(invoices)
    .where(and(eq(invoices.customerId, customerId), eq(invoices.kind, 'membership'), ne(invoices.status, 'draft')));
  return rows.map((r) => r.month);
}

/** D89: a change to all future months starts on the 1st of the next month that hasn't been invoiced. */
export async function changeStartFor(q: Q, customerId: string, now: Date): Promise<IsoDate> {
  return firstUninvoicedMonthStart(londonDate(now), await invoicedMonths(q, customerId));
}

/**
 * Space check (approved plan: approval is blocked while a day is full). Looks at every open day the
 * plan would book within the 60-day book-ahead window (D47) and returns the dates without space.
 * Days this dog already holds are ignored (its own place is kept). Locks the days, so call in a transaction.
 */
export async function fullDatesFor(
  tx: Tx,
  dogId: string,
  plan: DaysPlan,
  from: IsoDate,
  now: Date,
): Promise<IsoDate[]> {
  const settings = await loadSettings(tx);
  const today = londonDate(now);
  const horizon = addDays(today, HORIZON_DAYS);
  const start = from > today ? from : addDays(today, 1);
  if (start > horizon) return [];
  const closed = await closuresBetween(tx, start, horizon);
  const dates = membershipDates(plan.weekdays, start, horizon).filter(
    (date) =>
      checkBookableDate({
        date,
        today,
        settings: { ...settings, maxAdvanceDays: HORIZON_DAYS },
        closedReason: closed.get(date),
      }).ok,
  );
  if (!dates.length) return [];
  const held = await tx
    .select({ d: bookingDogs.serviceDate })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.dogId, dogId),
        inArray(bookingDogs.serviceDate, dates),
        inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'requested']),
      ),
    );
  const mine = new Set(held.map((h) => h.d));
  const days = await lockDays(tx, dates, settings, now);
  return dates.filter((d) => {
    if (mine.has(d)) return false;
    const day = days.get(d);
    return day ? !fits(plan.session, plan.taxi, day.used, day.cap).ok : false;
  });
}

export const fullDatesMessage = (dates: IsoDate[]) =>
  `There’s no space on ${dates.slice(0, 3).map(formatUkDate).join(', ')}${dates.length > 3 ? ` and ${dates.length - 3} more` : ''}. Choose other days.`;

/**
 * Start a membership for a dog, or replace its current one from `startsOn` (D89). Inside the
 * caller's transaction. Booked days of the old membership from `startsOn` are cancelled free of
 * charge (D48); the caller books the new days ahead (materialiseMemberships) after commit.
 */
export async function setMembershipDaysTx(
  tx: Tx,
  actor: Actor,
  p: DaysPlan & {
    customerId: string;
    dogId: string;
    startsOn: IsoDate;
    /** The user the membership is recorded as requested by (the customer, or the Owner for direct changes). */
    requestedBy: string;
    now: Date;
    source: 'owner' | 'offer' | 'request';
  },
): Promise<{ id: string; replacedId: string | null }> {
  const by = actor.kind === 'user' ? actor.userId : null;
  const current = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.dogId, p.dogId),
        eq(memberships.status, 'active'),
        or(isNull(memberships.endsOn), gte(memberships.endsOn, p.startsOn)),
      ),
    )
    .for('update');
  let replacedId: string | null = null;
  const weekdays = [...new Set(p.weekdays)].sort();
  // Same start date as a membership that hasn't started: change it in place rather than leaving
  // an "ended" row that never ran (Tester, PR #45). Its booked days are cancelled and rebooked.
  const sameStart = current.find((m) => m.startsOn === p.startsOn && m.startsOn > londonDate(p.now));
  for (const m of current) {
    replacedId = m.id;
    if (m === sameStart) {
      await tx
        .update(memberships)
        .set({
          weekdays,
          session: p.session,
          taxi: p.taxi,
          requestedBy: p.requestedBy,
          requestedAt: p.now,
          decidedBy: by,
          decidedAt: p.now,
          version: m.version + 1,
        })
        .where(eq(memberships.id, m.id));
      await cancelDaysAfter(tx, m.id, addDays(m.startsOn, -1), by, p.now);
    } else if (m.startsOn >= p.startsOn) {
      // Not started by the new start date: it never runs.
      await tx
        .update(memberships)
        .set({ status: 'ended', endsOn: m.startsOn, version: m.version + 1 })
        .where(eq(memberships.id, m.id));
      await cancelDaysAfter(tx, m.id, addDays(m.startsOn, -1), by, p.now);
    } else {
      const lastDay = addDays(p.startsOn, -1);
      await tx
        .update(memberships)
        .set({ endsOn: lastDay, version: m.version + 1 })
        .where(eq(memberships.id, m.id));
      await cancelDaysAfter(tx, m.id, lastDay, by, p.now);
    }
  }
  if (sameStart) {
    await recordAudit(tx, {
      actor,
      action: 'membership.days_changed',
      entityType: 'membership',
      entityId: sameStart.id,
      metadata: { days: weekdays.length, source: p.source, startsOn: p.startsOn, inPlace: true },
    });
    return { id: sameStart.id, replacedId: sameStart.id };
  }
  const [row] = await tx
    .insert(memberships)
    .values({
      customerId: p.customerId,
      dogId: p.dogId,
      weekdays,
      session: p.session,
      taxi: p.taxi,
      status: 'active',
      startsOn: p.startsOn,
      replacesId: replacedId,
      requestedBy: p.requestedBy,
      decidedBy: by,
      decidedAt: p.now,
    })
    .returning({ id: memberships.id });
  await recordAudit(tx, {
    actor,
    action: replacedId ? 'membership.days_changed' : 'membership.started',
    entityType: 'membership',
    entityId: row!.id,
    metadata: { days: weekdays.length, source: p.source, startsOn: p.startsOn },
  });
  return { id: row!.id, replacedId };
}

/** The dog's membership that is running or due to start (latest start first). */
export async function currentMembership(q: Q, dogId: string, today: IsoDate) {
  const rows = await q
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.dogId, dogId),
        eq(memberships.status, 'active'),
        or(isNull(memberships.endsOn), gt(memberships.endsOn, today)),
      ),
    );
  return rows.sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1))[0] ?? null;
}
