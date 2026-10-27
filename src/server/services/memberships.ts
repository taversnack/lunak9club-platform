import 'server-only';
import { LIVE_STATUSES, OPEN_STATUSES } from '@/domain/booking/rules';
import { raiseRefundRequests, refreshMembershipDrafts } from './billing';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import { bookingDogs, bookings, customers, dogs, memberships, users } from '@/infra/db/schema';
import { checkBookableDate, fits, SESSION_LABELS, type Session } from '@/domain/booking/rules';
import { allBlocks, blocksForEvaluation } from '@/domain/compliance/attendance';
import { changeEffectiveDate, membershipDates } from '@/domain/membership/rules';
import { bandFor } from '@/domain/pricing/engine';
import { addDays, formatUkDate, londonDate, type IsoDate } from '@/domain/time';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { idOrNotFound, isoDate, optionalText, parseInput, requiredText } from '../validation';
import { asUser, getMyCustomer } from './customers';
import { evaluateDogs } from './compliance-facts';
import { closuresBetween, consume, loadSettings, lockDays } from './booking-shared';
import { currentPrices, loadPricingContext, priceWith, writeSnapshot } from './pricing';
import { appUrl, sendSafely } from '../notify';
import { membershipConfirmedMessage } from '@/infra/email/templates';

export const HORIZON_DAYS = 60;
const WEEKDAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const describeWeekdays = (w: readonly number[]) =>
  [...w]
    .sort()
    .map((d) => WEEKDAY_NAMES[d])
    .join(', ');

export const overlaps = (aFrom: IsoDate, aTo: IsoDate | null, bFrom: IsoDate, bTo: IsoDate | null) =>
  (aTo === null || aTo >= bFrom) && (bTo === null || bTo >= aFrom);

/** The customer's memberships with their band and price. */
export async function myMemberships(db: Db, actor: Actor, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'memberships.self.manage', { ownerUserId: customer.userId });
  const [rows, book] = await Promise.all([
    db
      .select({ m: memberships, dogName: dogs.name })
      .from(memberships)
      .innerJoin(dogs, eq(dogs.id, memberships.dogId))
      .where(eq(memberships.customerId, customer.id))
      .orderBy(desc(memberships.requestedAt)),
    currentPrices(db, now),
  ]);
  return {
    book,
    changeFrom: changeEffectiveDate(londonDate(now)),
    memberships: rows.map((r) => ({
      ...r.m,
      dogName: r.dogName,
      band: book ? bandFor(r.m.weekdays.length, book) : null,
      dayPrice: book
        ? bandFor(r.m.weekdays.length, book) === 'high'
          ? book.memberHighFullPence
          : book.memberLowFullPence
        : null,
    })),
  };
}

async function loadMine(db: Db, actor: Actor, rawId: string) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'memberships.self.manage', { ownerUserId: customer.userId });
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, idOrNotFound(rawId, 'Membership')), eq(memberships.customerId, customer.id)));
  if (!m) throw new NotFoundError('Membership');
  return { me, m };
}

/** Legacy (D47 requests made before D86): the customer can still withdraw one that is waiting. */
export async function withdrawMembershipRequest(db: Db, actor: Actor, rawId: string) {
  const { me, m } = await loadMine(db, actor, rawId);
  if (m.status !== 'requested') throw new ConflictError('Only requests that are still waiting can be withdrawn.');
  await db.transaction(async (tx) => {
    await tx
      .update(memberships)
      .set({ status: 'withdrawn', version: m.version + 1 })
      .where(eq(memberships.id, m.id));
    await recordAudit(tx, { actor: me, action: 'membership.withdrawn', entityType: 'membership', entityId: m.id });
  });
}

/** Cancel the membership's booked days after `lastDay` (free of charge, D48). */
export async function cancelDaysAfter(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  membershipId: string,
  lastDay: IsoDate,
  by: string | null,
  now: Date,
) {
  const rows = await tx
    .update(bookingDogs)
    .set({ status: 'cancelled', cancelledAt: now, cancelledBy: by, lateCancellation: false })
    .where(
      and(
        eq(bookingDogs.membershipId, membershipId),
        gt(bookingDogs.serviceDate, lastDay),
        inArray(bookingDogs.status, [...OPEN_STATUSES]),
      ),
    )
    .returning({ id: bookingDogs.id });
  await raiseRefundRequests(tx, { bookingDogIds: rows.map((r) => r.id) });
  return rows.length;
}

/** Customer leaves: the membership ends the day before the next allowed 1st (D48). */
export async function leaveMembership(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const { me, m } = await loadMine(db, actor, rawId);
  if (m.status !== 'active') throw new ConflictError('Only active memberships can be ended.');
  const lastDay = addDays(changeEffectiveDate(londonDate(now)), -1);
  if (m.endsOn && m.endsOn <= lastDay) throw new ConflictError('This membership already ends on or before that date.');
  const endsOn = lastDay < m.startsOn ? m.startsOn : lastDay;
  await db.transaction(async (tx) => {
    await tx
      .update(memberships)
      .set({ endsOn, version: m.version + 1 })
      .where(and(eq(memberships.id, m.id), eq(memberships.version, m.version)));
    const cancelled = await cancelDaysAfter(tx, m.id, endsOn, me.userId, now);
    await recordAudit(tx, {
      actor: me,
      action: 'membership.leaving',
      entityType: 'membership',
      entityId: m.id,
      metadata: { endsOn, cancelledDays: cancelled },
    });
  });
  return { endsOn };
}

// ---- Owner -------------------------------------------------------------------------

export async function ownerMemberships(db: Db, actor: Actor) {
  assertAuthorized(actor, 'memberships.manage');
  const rows = await db
    .select({ m: memberships, dogName: dogs.name, customerName: users.name, customerId: customers.id })
    .from(memberships)
    .innerJoin(dogs, eq(dogs.id, memberships.dogId))
    .innerJoin(customers, eq(customers.id, memberships.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(inArray(memberships.status, ['requested', 'active']))
    .orderBy(asc(memberships.status), asc(dogs.name));
  return {
    requests: rows.filter((r) => r.m.status === 'requested'),
    active: rows.filter((r) => r.m.status === 'active'),
  };
}

export const DecisionInput = z.object({ version: z.coerce.number().int().positive(), reason: optionalText(300) });

/** Owner approves a legacy request (made before D86): membership becomes active, any replaced membership ends, days are booked ahead. */
export async function approveMembership(db: Db, actor: Actor, rawId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'memberships.manage');
  const d = parseInput(DecisionInput, input);
  const id = idOrNotFound(rawId, 'Membership');
  const by = actor.kind === 'user' ? actor.userId : null;
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, id)).for('update');
    if (!m) throw new NotFoundError('Membership');
    if (m.status !== 'requested') throw new ConflictError('This request has already been decided.');
    if (m.version !== d.version) throw new ConflictError('This request changed. Please reload.');
    if (m.replacesId) {
      const lastDay = addDays(m.startsOn, -1);
      await tx.update(memberships).set({ endsOn: lastDay }).where(eq(memberships.id, m.replacesId));
      await cancelDaysAfter(tx, m.replacesId, lastDay, by, now);
    }
    await tx
      .update(memberships)
      .set({ status: 'active', decidedBy: by, decidedAt: now, version: m.version + 1 })
      .where(eq(memberships.id, id));
    await recordAudit(tx, { actor, action: 'membership.approved', entityType: 'membership', entityId: id });
  });
  const result = await materialiseMemberships(db, actor, { membershipId: id }, now);
  // Joining part-month (D19): the draft appears for the Owner to check and send.
  const [mem] = await db.select({ customerId: memberships.customerId }).from(memberships).where(eq(memberships.id, id));
  const drafts = mem ? await refreshMembershipDrafts(db, actor, { customerId: mem.customerId }, now) : null;
  const [row] = await db
    .select({ email: users.email, name: users.name, dogName: dogs.name, m: memberships })
    .from(memberships)
    .innerJoin(dogs, eq(dogs.id, memberships.dogId))
    .innerJoin(customers, eq(customers.id, memberships.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(memberships.id, id));
  if (row) {
    await sendSafely(
      membershipConfirmedMessage(row.email, row.name.split(' ')[0], {
        dogName: row.dogName,
        pattern: `${describeWeekdays(row.m.weekdays)}, ${SESSION_LABELS[row.m.session as Session]}`,
        startsOn: formatUkDate(row.m.startsOn),
        url: appUrl('/account/bookings'),
      }),
    );
  }
  return { ...result, drafts: drafts?.drafts ?? 0 };
}

export async function declineMembership(db: Db, actor: Actor, rawId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'memberships.manage');
  const d = parseInput(DecisionInput.extend({ reason: requiredText('a reason the customer will see', 300) }), input);
  const id = idOrNotFound(rawId, 'Membership');
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, id)).for('update');
    if (!m) throw new NotFoundError('Membership');
    if (m.status !== 'requested') throw new ConflictError('This request has already been decided.');
    if (m.version !== d.version) throw new ConflictError('This request changed. Please reload.');
    await tx
      .update(memberships)
      .set({
        status: 'declined',
        declineReason: d.reason,
        decidedBy: actor.kind === 'user' ? actor.userId : null,
        decidedAt: now,
        version: m.version + 1,
      })
      .where(eq(memberships.id, id));
    await recordAudit(tx, { actor, action: 'membership.declined', entityType: 'membership', entityId: id });
  });
}

export const OwnerEndInput = z.object({ version: z.coerce.number().int().positive(), endsOn: isoDate('the last day') });

/** Owner ends a membership on a chosen last day; later booked days are cancelled free of charge. */
export async function ownerEndMembership(db: Db, actor: Actor, rawId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'memberships.manage');
  const d = parseInput(OwnerEndInput, input);
  const id = idOrNotFound(rawId, 'Membership');
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(memberships).where(eq(memberships.id, id)).for('update');
    if (!m || m.status !== 'active') throw new NotFoundError('Membership');
    if (m.version !== d.version) throw new ConflictError('This membership changed. Please reload.');
    if (d.endsOn < m.startsOn)
      throw new ValidationError('Please check the highlighted fields.', {
        endsOn: 'The last day can’t be before the start',
      });
    await tx
      .update(memberships)
      .set({ endsOn: d.endsOn, version: m.version + 1 })
      .where(eq(memberships.id, id));
    const cancelled = await cancelDaysAfter(tx, id, d.endsOn, actor.kind === 'user' ? actor.userId : null, now);
    await recordAudit(tx, {
      actor,
      action: 'membership.ended_by_owner',
      entityType: 'membership',
      entityId: id,
      metadata: { endsOn: d.endsOn, cancelledDays: cancelled },
    });
  });
}

/**
 * Book each active membership's days up to HORIZON_DAYS ahead (D47). Idempotent: dates the dog
 * already holds are skipped. Full days go on the waitlist and are reported. Closed days are skipped.
 * Runs on approval, from the Owner's "book ahead" button and (Phase 5) nightly.
 */
export async function materialiseMemberships(
  db: Db,
  actor: Actor,
  opts: { membershipId?: string } = {},
  now = new Date(),
) {
  assertAuthorized(actor, 'memberships.manage');
  const settings = await loadSettings(db);
  const today = londonDate(now);
  const horizon = addDays(today, HORIZON_DAYS);
  const active = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.status, 'active'),
        opts.membershipId ? eq(memberships.id, opts.membershipId) : undefined,
        lte(memberships.startsOn, horizon),
        or(isNull(memberships.endsOn), gt(memberships.endsOn, today)),
      ),
    );
  const result = {
    booked: 0,
    waitlisted: 0,
    skippedClosed: 0,
    skippedBlocked: 0,
    clashes: [] as { dogId: string; date: IsoDate; reason: string }[],
  };
  if (!active.length) return result;
  const closed = await closuresBetween(db, addDays(today, 1), horizon);
  const evals = await evaluateDogs(db, [...new Set(active.map((m) => m.dogId))], now);

  for (const m of active) {
    const from = m.startsOn > today ? m.startsOn : addDays(today, 1);
    const to = m.endsOn && m.endsOn < horizon ? m.endsOn : horizon;
    const dates = membershipDates(m.weekdays, from, to).filter((date) => {
      const ok = checkBookableDate({
        date,
        today,
        settings: { ...settings, maxAdvanceDays: HORIZON_DAYS },
        closedReason: closed.get(date),
      }).ok;
      if (!ok) result.skippedClosed++;
      return ok;
    });
    if (!dates.length) continue;
    const e = evals.get(m.dogId);
    const ctx = await loadPricingContext(db, m.customerId, dates[0]!, dates.at(-1)!);

    await db.transaction(async (tx) => {
      const days = await lockDays(tx, dates, settings, now);
      const held = await tx
        .select({ serviceDate: bookingDogs.serviceDate })
        .from(bookingDogs)
        .where(
          and(
            eq(bookingDogs.dogId, m.dogId),
            inArray(bookingDogs.serviceDate, dates),
            inArray(bookingDogs.status, [...LIVE_STATUSES]),
          ),
        );
      const heldSet = new Set(held.map((h) => h.serviceDate));
      const todo = dates.filter((d) => !heldSet.has(d));
      if (!todo.length) return;
      const [b] = await tx
        .insert(bookings)
        .values({ customerId: m.customerId, createdBy: m.requestedBy, source: 'owner' })
        .returning({ id: bookings.id });
      for (const date of todo) {
        // No overrides on automatic bookings: any vaccination block skips the day (D47, D73, D74).
        const [block] = e ? allBlocks(blocksForEvaluation(e, date)) : [];
        if (!e?.canBook || block) {
          result.skippedBlocked++;
          result.clashes.push({ dogId: m.dogId, date, reason: block ?? 'Dog can’t be booked' });
          continue;
        }
        const day = days.get(date)!;
        const session = m.session as Session;
        const f = fits(session, m.taxi, day.used, day.cap);
        if (f.ok) consume(day.used, session, m.taxi);
        const [row] = await tx
          .insert(bookingDogs)
          .values({
            bookingId: b!.id,
            customerId: m.customerId,
            dogId: m.dogId,
            serviceDate: date,
            session,
            taxi: m.taxi,
            status: f.ok ? 'confirmed' : 'waitlisted',
            kind: 'membership',
            membershipId: m.id,
          })
          .returning({ id: bookingDogs.id });
        await writeSnapshot(
          tx,
          row!.id,
          priceWith(ctx, { dogId: m.dogId, date, session, taxi: m.taxi, dogIndexOnDate: 0 }),
        );
        if (f.ok) result.booked++;
        else {
          result.waitlisted++;
          result.clashes.push({
            dogId: m.dogId,
            date,
            reason: f.reason === 'taxi_full' ? 'Taxi full – waitlisted' : 'Full – waitlisted',
          });
        }
      }
      await recordAudit(tx, {
        actor,
        action: 'membership.days_booked',
        entityType: 'membership',
        entityId: m.id,
        metadata: { booked: result.booked, waitlisted: result.waitlisted },
      });
    });
  }
  return result;
}
