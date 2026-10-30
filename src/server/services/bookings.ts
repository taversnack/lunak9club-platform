import 'server-only';
import { endedReason } from '@/domain/booking/ended-reason';
import { formatPounds, LIVE_STATUSES, OPEN_STATUSES, PRICED_PLACE_STATUSES } from '@/domain/booking/rules';
import { trialAlreadyUsed } from '@/domain/booking/wording';
import { raiseRefundRequests } from './billing';
import { submitPendingRefunds } from './card-refunds';
import { refundBookingDayTx, releaseBookingHold } from './payments';
import { createApprovalRequest, withdrawMyApprovalRequest } from './approvals';
import { BOOKING_REQUEST, bookingSubjectKey, pendingRequestFor, requestedLeft } from './booking-requests';
import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import { bookingDogs, bookings, customers, dogPermissions, dogs, priceSnapshots, users } from '@/infra/db/schema';
import {
  availabilityLabel,
  calendarDates,
  cancellationTerms,
  checkBookableDate,
  fits,
  remainingFor,
  type Session,
} from '@/domain/booking/rules';
import { addDays, formatUkDate, londonDate, type IsoDate } from '@/domain/time';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { idOrNotFound, isoDate, optionalText, parseInput } from '../validation';
import { asUser, getMyCustomer, isProfileComplete } from './customers';
import { evaluateDogs } from './compliance-facts';
import { allBlocks, blocksForEvaluation } from '@/domain/compliance/attendance';
import {
  dogsWithTrialDay,
  lockDogAndCheckTrialUsed,
  closuresBetween,
  consume,
  daysOverview,
  describeSession,
  loadSettings,
  lockDays,
} from './booking-shared';
import { loadPricingContext, priceWith, writeSnapshot } from './pricing';
import type { Price } from '@/domain/pricing/engine';
import { appUrl, firstNameOf, sendSafely } from '../notify';
import {
  bookingCancelledMessage,
  bookingRequestedMessage,
  bookingSummaryMessage,
  type BookingLine,
} from '@/infra/email/templates';

/** The customer's dogs with whether each can book, and vaccination expiry facts for per-date checks. */
export async function myBookableDogs(db: Db, actor: Actor) {
  const customer = await getMyCustomer(db, actor);
  const rows = await db
    .select({ id: dogs.id, name: dogs.name, status: dogs.status, transport: dogPermissions.transport })
    .from(dogs)
    .leftJoin(dogPermissions, eq(dogPermissions.dogId, dogs.id))
    .where(and(eq(dogs.customerId, customer.id), isNull(dogs.archivedAt)))
    .orderBy(asc(dogs.createdAt));
  const ids = rows.map((r) => r.id);
  const [evals, trialUsed] = await Promise.all([evaluateDogs(db, ids), dogsWithTrialDay(db, ids)]);
  return rows.map((r) => {
    const e = evals.get(r.id)!;
    const notApproved = r.status === 'not_started' || r.status === 'pending_review';
    return {
      id: r.id,
      name: r.name,
      taxiAllowed: Boolean(r.transport),
      canBook: e.canBook,
      /** A dog not approved yet can be requested for a trial day (D85), once only (D96). */
      canRequestTrial: notApproved && !trialUsed.has(r.id),
      /** Set when the dog would need a trial day but already has one requested, approved or taken (D96). */
      trialUsed: notApproved && trialUsed.has(r.id),
      blockers: e.bookingBlockers,
      /** Facts for the vaccination rules per date (D40, D73, D74). */
      attendance: {
        items: e.items.filter((i) => i.kind === 'vaccination'),
        primaryCourseCompletedOn: e.primaryCourseCompletedOn,
      },
    };
  });
}

/** Calendar for the booking page: availability per session and the customer's own bookings. */
export async function bookingCalendar(db: Db, actor: Actor, now = new Date()) {
  const customer = await getMyCustomer(db, actor);
  const settings = await loadSettings(db);
  const today = londonDate(now);
  const dates = calendarDates(today, Math.min(settings.maxAdvanceDays, 42));
  const [closed, overview, mine] = await Promise.all([
    closuresBetween(db, dates[0]!, dates.at(-1)!),
    daysOverview(db, dates, settings, now),
    db
      .select({
        serviceDate: bookingDogs.serviceDate,
        status: bookingDogs.status,
        dogName: dogs.name,
        session: bookingDogs.session,
      })
      .from(bookingDogs)
      .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
      .where(
        and(
          eq(bookingDogs.customerId, customer.id),
          inArray(bookingDogs.serviceDate, dates),
          inArray(bookingDogs.status, [...OPEN_STATUSES]),
        ),
      ),
  ]);
  return {
    settings,
    days: dates.map((date) => {
      const check = checkBookableDate({ date, today, settings, closedReason: closed.get(date) });
      const o = overview.get(date)!;
      const left = {
        full: remainingFor('full', o.used, o.cap),
        am: remainingFor('am', o.used, o.cap),
        pm: remainingFor('pm', o.used, o.cap),
      };
      return {
        date,
        open: check.ok,
        closedReason: check.ok ? null : check.reason,
        left,
        availability: availabilityLabel(left.full, !check.ok),
        taxiLeft: o.cap.taxi - o.used.taxi,
        mine: mine.filter((m) => m.serviceDate === date),
      };
    }),
  };
}

export const CreateBookingInput = z.object({
  dogIds: z.array(z.string()).min(1, 'Choose at least one dog'),
  dates: z.array(isoDate('the date')).min(1, 'Choose at least one date').max(30, 'Book up to 30 days at a time'),
  session: z.literal('full', { message: 'We only offer full days' }).default('full'),
  taxi: z.boolean(),
  ifFull: z.enum(['waitlist', 'skip']).default('waitlist'),
  customerNote: optionalText(500),
  /** A trial day for a dog that isn't approved yet (D85): one dog, one date. */
  trial: z.boolean().default(false),
});

export type BookingOutcome = {
  dogId: string;
  dogName: string;
  date: IsoDate;
  /** requested: a place is free and is held for the Owner's decision (D76). */
  outcome: 'requested' | 'waitlisted' | 'skipped';
  reason?: string;
  price?: Price;
};

/**
 * Customer books one or more dogs on one or more dates. All places are reserved in a single
 * transaction that locks each day's row first, so two people can never take the same last place.
 */
async function validateRequest(db: Db, actor: Actor, input: unknown, now: Date) {
  const d = parseInput(CreateBookingInput, input);
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'bookings.self.manage', { ownerUserId: customer.userId });
  const settings = await loadSettings(db);
  const today = londonDate(now);
  const session = d.session as Session;
  const dates = [...new Set(d.dates)].sort();

  const myDogs = await myBookableDogs(db, me);
  const chosen = [...new Set(d.dogIds)].map((id) => {
    const dog = myDogs.find((x) => x.id === id);
    if (!dog) throw new NotFoundError('Dog');
    return dog;
  });
  const fields: Record<string, string> = {};
  if (d.trial && (chosen.length !== 1 || dates.length !== 1)) fields.dates = 'A trial day is for one dog on one date.';
  for (const dog of chosen) {
    if (d.trial ? !dog.canRequestTrial : !dog.canBook)
      fields.dogIds = d.trial
        ? dog.trialUsed
          ? trialAlreadyUsed(dog.name)
          : `${dog.name} doesn’t need a trial day request: ${dog.canBook ? 'they’re already approved, so book a normal day' : (dog.blockers[0] ?? 'please contact us')}`
        : `${dog.name} can’t be booked yet: ${dog.blockers[0] ?? 'please finish onboarding'}`;
    if (d.taxi && !dog.taxiAllowed)
      fields.taxi = `You haven’t given permission for ${dog.name} to use the dog taxi. Update the onboarding form first.`;
  }
  if (d.taxi && !isProfileComplete(customer)) fields.taxi = 'Add your address before booking the dog taxi.';
  const closed = await closuresBetween(db, dates[0]!, dates.at(-1)!);
  for (const date of dates) {
    const c = checkBookableDate({ date, today, settings, closedReason: closed.get(date) });
    if (!c.ok) fields.dates = `${date}: ${c.reason}`;
    for (const dog of chosen) {
      // Customers can't override any vaccination block.
      const [block] = allBlocks(blocksForEvaluation(dog.attendance, date));
      if (block) fields.dates = `${dog.name} on ${formatUkDate(date)}: ${block}`;
    }
  }
  if (Object.keys(fields).length) throw new ValidationError('Some of these can’t be booked.', fields);
  return { d, me, customer, settings, session, dates, chosen };
}

/** Dry run for the review step: what would happen right now, and the price of each dog-day. Reserves nothing. */
export async function previewMyBookings(db: Db, actor: Actor, input: unknown, now = new Date()) {
  const { d, customer, settings, session, dates, chosen } = await validateRequest(db, actor, input, now);
  const overview = await daysOverview(db, dates, settings, now);
  const existing = await db
    .select({ dogId: bookingDogs.dogId, serviceDate: bookingDogs.serviceDate })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.customerId, customer.id),
        inArray(bookingDogs.serviceDate, dates),
        inArray(bookingDogs.status, [...LIVE_STATUSES]),
      ),
    );
  const ctx = await loadPricingContext(db, customer.id, dates[0]!, dates.at(-1)!);
  const otherDogsOn = await liveDogCounts(db, customer.id, dates);
  const lines: BookingOutcome[] = [];
  for (const date of dates) {
    const o = overview.get(date)!;
    const used = { ...o.used };
    let idx = otherDogsOn.get(date) ?? 0;
    for (const dog of chosen) {
      if (existing.some((e) => e.dogId === dog.id && e.serviceDate === date)) {
        lines.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'skipped', reason: 'Already booked' });
        continue;
      }
      const f = fits(session, d.taxi, used, o.cap);
      const price = priceWith(ctx, {
        dogId: dog.id,
        date,
        session,
        taxi: d.taxi,
        dogIndexOnDate: idx,
        isTrial: d.trial,
      });
      const reason = f.reason === 'taxi_full' ? 'Taxi is full' : 'Full';
      if (f.ok) {
        consume(used, session, d.taxi);
        idx++;
        lines.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'requested', price });
      } else if (d.ifFull === 'waitlist') {
        lines.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'waitlisted', reason, price });
      } else {
        lines.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'skipped', reason });
      }
    }
  }
  return {
    request: { ...d, dates },
    lines,
    totalPence: lines.filter((l) => l.outcome === 'requested').reduce((sum, l) => sum + (l.price?.totalPence ?? 0), 0),
    freeCancellationHours: settings.freeCancellationHours,
  };
}

/**
 * Customer requests one or more dogs on one or more dates (D76). Free places are held as `requested`
 * (they count against capacity) in a single transaction that locks each day's row first, so two
 * people can never take the same last place. The price is fixed now (D45); nothing is charged and no
 * checkout starts until the Owner approves (D78). Full days go on the waitlist (D81).
 */
export async function createMyBookings(db: Db, actor: Actor, input: unknown, now = new Date()) {
  const { d, me, customer, settings, session, dates, chosen } = await validateRequest(db, actor, input, now);

  const outcomes: BookingOutcome[] = [];
  const ctx = await loadPricingContext(db, customer.id, dates[0]!, dates.at(-1)!);
  let bookingId = '';
  // Set inside the transaction callback; held in an object so TypeScript doesn't narrow them to null.
  const created: { requestId: string | null; notifyOwner: (() => Promise<void>) | null } = {
    requestId: null,
    notifyOwner: null,
  };
  await db.transaction(async (tx) => {
    const days = await lockDays(tx, dates, settings, now);
    if (d.trial) {
      // One trial day per dog (D96). Lock the dog's row so two trial requests sent at the same time
      // (for any dates) run one after the other, then check again: the second sees the first's day.
      const dog = chosen[0]!;
      if (await lockDogAndCheckTrialUsed(tx, dog.id))
        throw new ValidationError('Some of these can’t be booked.', { dogIds: trialAlreadyUsed(dog.name) });
    }
    // Closing a day takes the same lock, so a closure added since the check above is visible now.
    const closedNow = await closuresBetween(tx, dates[0]!, dates.at(-1)!);
    for (const date of dates)
      if (closedNow.has(date))
        throw new ValidationError('Some of these can’t be booked.', {
          dates: `${date}: Closed: ${closedNow.get(date)}`,
        });
    const existing = await tx
      .select({ dogId: bookingDogs.dogId, serviceDate: bookingDogs.serviceDate })
      .from(bookingDogs)
      .where(
        and(
          inArray(
            bookingDogs.dogId,
            chosen.map((c) => c.id),
          ),
          inArray(bookingDogs.serviceDate, dates),
          inArray(bookingDogs.status, [...LIVE_STATUSES]),
        ),
      );
    const [booking] = await tx
      .insert(bookings)
      .values({ customerId: customer.id, createdBy: me.userId, source: 'customer' })
      .returning({ id: bookings.id });
    const toInsert: (typeof bookingDogs.$inferInsert)[] = [];
    const prices: Price[] = [];
    const otherDogsOn = await liveDogCounts(tx, customer.id, dates);
    for (const date of dates) {
      const day = days.get(date)!;
      let idx = otherDogsOn.get(date) ?? 0;
      for (const dog of chosen) {
        if (existing.some((e) => e.dogId === dog.id && e.serviceDate === date)) {
          outcomes.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'skipped', reason: 'Already booked' });
          continue;
        }
        const f = fits(session, d.taxi, day.used, day.cap);
        const base = {
          bookingId: booking!.id,
          customerId: customer.id,
          dogId: dog.id,
          serviceDate: date,
          session,
          taxi: d.taxi,
          customerNote: d.customerNote,
          kind: d.trial ? ('trial' as const) : ('standard' as const),
        };
        const price = priceWith(ctx, {
          dogId: dog.id,
          date,
          session,
          taxi: d.taxi,
          dogIndexOnDate: idx,
          isTrial: d.trial,
        });
        const reason = f.reason === 'taxi_full' ? 'Taxi is full' : 'Full';
        if (f.ok) {
          consume(day.used, session, d.taxi);
          idx++;
          toInsert.push({ ...base, status: 'requested' });
          prices.push(price);
          outcomes.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'requested', price });
        } else if (d.ifFull === 'waitlist') {
          toInsert.push({ ...base, status: 'waitlisted' });
          prices.push(price);
          outcomes.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'waitlisted', reason, price });
        } else {
          outcomes.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'skipped', reason });
        }
      }
    }
    bookingId = booking!.id;
    const requested: { id: string; pence: number }[] = [];
    if (toInsert.length) {
      const ids = await tx.insert(bookingDogs).values(toInsert).returning({ id: bookingDogs.id });
      for (let i = 0; i < ids.length; i++) {
        await writeSnapshot(tx, ids[i]!.id, prices[i]!);
        if (toInsert[i]!.status === 'requested') requested.push({ id: ids[i]!.id, pence: prices[i]!.totalPence });
      }
    }
    if (requested.length) {
      const r = await createApprovalRequest(
        db,
        me,
        {
          type: BOOKING_REQUEST,
          customerId: customer.id,
          subjectKey: bookingSubjectKey(booking!.id),
          payload: {
            bookingId: booking!.id,
            bookingDogIds: requested.map((x) => x.id),
            kind: d.trial ? 'trial' : 'standard',
            totalPence: requested.reduce((a, x) => a + x.pence, 0),
            dogNames: outcomes.filter((o) => o.outcome === 'requested').map((o) => o.dogName),
            dates: outcomes.filter((o) => o.outcome === 'requested').map((o) => o.date),
          },
        },
        { tx },
      );
      created.requestId = r.id;
      created.notifyOwner = r.notifyOwner;
    }
    await recordAudit(tx, {
      actor: me,
      action: 'booking.created',
      entityType: 'booking',
      entityId: booking!.id,
      metadata: {
        requested: outcomes.filter((o) => o.outcome === 'requested').length,
        waitlisted: outcomes.filter((o) => o.outcome === 'waitlisted').length,
        skipped: outcomes.filter((o) => o.outcome === 'skipped').length,
        session,
        taxi: d.taxi,
      },
    });
  });

  await created.notifyOwner?.();
  const who = await contactOf(db, me.userId);
  const lineOf = (o: BookingOutcome): BookingLine => ({
    dogName: o.dogName,
    ...describeSession(o.date, session),
    outcome:
      o.outcome === 'requested'
        ? `requested${o.price ? ` – ${formatPounds(o.price.totalPence)}` : ''}`
        : 'on the waitlist – we’ll be in touch if a place comes up',
  });
  const requestedLines = outcomes.filter((o) => o.outcome === 'requested');
  const waitlisted = outcomes.filter((o) => o.outcome === 'waitlisted');
  // The request confirmation carries the agreed "does not secure your booking" wording (D76).
  if (requestedLines.length)
    await sendSafely(
      bookingRequestedMessage(
        who.email,
        firstNameOf(who.name),
        [...requestedLines, ...waitlisted].map(lineOf),
        appUrl('/account/bookings'),
      ),
    );
  else if (waitlisted.length)
    await sendSafely(
      bookingSummaryMessage(who.email, firstNameOf(who.name), waitlisted.map(lineOf), appUrl('/account/bookings')),
    );
  return {
    bookingId,
    requestId: created.requestId,
    outcomes,
    totalPence: requestedLines.reduce((sum, o) => sum + (o.price?.totalPence ?? 0), 0),
  };
}

/** How many of this customer's dogs already hold a place on each date (for multi-dog discounts). */
async function liveDogCounts(db: Pick<Db, 'select'>, customerId: string, dates: IsoDate[]) {
  const rows = await db
    .select({ serviceDate: bookingDogs.serviceDate })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.customerId, customerId),
        inArray(bookingDogs.serviceDate, dates),
        inArray(bookingDogs.status, [...PRICED_PLACE_STATUSES]),
      ),
    );
  const m = new Map<IsoDate, number>();
  for (const r of rows) m.set(r.serviceDate, (m.get(r.serviceDate) ?? 0) + 1);
  return m;
}

export async function contactOf(db: Db, userId: string) {
  const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  return { email: u?.email ?? '', name: u?.name ?? '' };
}

/** The customer's bookings: upcoming (incl. waitlist and offers) and the last 30 days. */
export async function myBookings(db: Db, actor: Actor, now = new Date()) {
  const customer = await getMyCustomer(db, actor);
  const settings = await loadSettings(db);
  const today = londonDate(now);
  const rows = await db
    .select({
      id: bookingDogs.id,
      serviceDate: bookingDogs.serviceDate,
      session: bookingDogs.session,
      taxi: bookingDogs.taxi,
      status: bookingDogs.status,
      offerExpiresAt: bookingDogs.offerExpiresAt,
      lateCancellation: bookingDogs.lateCancellation,
      customerNote: bookingDogs.customerNote,
      version: bookingDogs.version,
      kind: bookingDogs.kind,
      dogName: dogs.name,
      pricePence: priceSnapshots.totalPence,
      // Used only to derive endedReason below; never returned to the customer.
      cancelledBy: bookingDogs.cancelledBy,
      internalNote: bookingDogs.internalNote,
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .leftJoin(priceSnapshots, eq(priceSnapshots.bookingDogId, bookingDogs.id))
    .where(and(eq(bookingDogs.customerId, customer.id), gte(bookingDogs.serviceDate, addDays(today, -30))))
    .orderBy(asc(bookingDogs.serviceDate), asc(dogs.name));
  const withTerms = rows.map(({ cancelledBy, internalNote, ...r }) => ({
    ...r,
    /** Why a day ended without being attended, for the timeline: a lapsed hold shows as payment_expired. */
    endedReason: endedReason({ status: r.status, cancelledBy, internalNote }, customer.userId),
    /** Booked or held for payment: cancel (with the 48-hour rule). Requested: withdraw at no charge. */
    cancellable: (r.status === 'confirmed' || r.status === 'pending_payment') && r.serviceDate > today,
    withdrawable: r.status === 'requested',
    /** On the waitlist: the customer can leave at any time (D81). */
    leavable: r.status === 'waitlisted',
    late: cancellationTerms(now, r.serviceDate, r.session, settings).late,
  }));
  return {
    upcoming: withTerms.filter((r) => r.serviceDate >= today && r.status !== 'cancelled' && r.status !== 'rejected'),
    past: withTerms
      .filter((r) => r.serviceDate < today || r.status === 'cancelled' || r.status === 'rejected')
      .reverse(),
    freeCancellationHours: settings.freeCancellationHours,
  };
}

async function loadMyBookingDog(db: Db, actor: Actor, rawId: string) {
  const me = asUser(actor);
  const id = idOrNotFound(rawId, 'Booking');
  const [row] = await db
    .select({ bd: bookingDogs, userId: customers.userId, dogName: dogs.name })
    .from(bookingDogs)
    .innerJoin(customers, eq(customers.id, bookingDogs.customerId))
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .where(and(eq(bookingDogs.id, id), eq(customers.userId, me.userId)));
  if (!row) throw new NotFoundError('Booking');
  assertAuthorized(me, 'bookings.self.manage', { ownerUserId: row.userId });
  return row;
}

/** Customer cancels. Less than the free-cancellation window before the start → marked late (charged). */
export async function cancelMyBooking(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const me = asUser(actor);
  const { bd, dogName } = await loadMyBookingDog(db, me, rawId);
  const settings = await loadSettings(db);
  const today = londonDate(now);
  // Waiting for a place or for the Owner: leaving / withdrawing is always free (D79, D81).
  if (bd.status === 'waitlisted') {
    await leaveWaitlist(db, me, rawId, now);
    return { late: false, refundedPence: 0 };
  }
  if (bd.status === 'requested') {
    await withdrawRequestedDay(db, me, rawId, now);
    return { late: false, refundedPence: 0 };
  }
  if (bd.status !== 'confirmed' && bd.status !== 'pending_payment')
    throw new ConflictError('This booking can’t be cancelled.');
  if (bd.serviceDate <= today) throw new ConflictError('Bookings for today can’t be cancelled online. Please call us.');
  if (bd.status === 'pending_payment') {
    // Not paid yet: cancelling releases every place held for that payment.
    await releaseBookingHold(db, bd.bookingId, bd.id, 'Cancelled by the customer before paying', now, me.userId);
    await recordAudit(db, { actor: me, action: 'booking.hold_cancelled', entityType: 'booking_dog', entityId: bd.id });
    return { late: false, refundedPence: 0 };
  }
  const late = bd.status === 'confirmed' && cancellationTerms(now, bd.serviceDate, bd.session, settings).late;
  let refundedPence = 0;
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(bookingDogs)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: me.userId,
        lateCancellation: late,
        version: bd.version + 1,
      })
      .where(and(eq(bookingDogs.id, bd.id), eq(bookingDogs.version, bd.version)))
      .returning({ id: bookingDogs.id });
    if (!updated.length) throw new ConflictError('This booking changed. Please reload.');
    if (!late) {
      await raiseRefundRequests(tx, { bookingDogIds: [bd.id] });
      refundedPence = await refundBookingDayTx(tx, bd.id, `Cancelled 48 hours or more ahead: ${dogName}`, now);
    }
    await recordAudit(tx, {
      actor: me,
      action: 'booking.cancelled',
      entityType: 'booking_dog',
      entityId: bd.id,
      metadata: { late, by: 'customer', from: bd.status },
    });
  });
  const who = await contactOf(db, me.userId);
  await sendSafely(
    bookingCancelledMessage(
      who.email,
      firstNameOf(who.name),
      {
        dogName,
        ...describeSession(bd.serviceDate, bd.session),
        outcome: late ? 'cancelled (late – charged)' : 'cancelled',
      },
      appUrl('/account/bookings'),
    ),
  );
  await submitPendingRefunds(db);
  return { late, refundedPence };
}

/**
 * Customer leaves the waitlist (D81). Allowed at any time, including on the day. The row is kept
 * (cancelled) for the record; there's no charge and no email – the confirmation is on screen.
 */
export async function leaveWaitlist(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const me = asUser(actor);
  const { bd } = await loadMyBookingDog(db, me, rawId);
  if (bd.status !== 'waitlisted') throw new ConflictError('This dog isn’t on the waitlist for this day.');
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(bookingDogs)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: me.userId,
        lateCancellation: false,
        version: bd.version + 1,
      })
      .where(and(eq(bookingDogs.id, bd.id), eq(bookingDogs.version, bd.version)))
      .returning({ id: bookingDogs.id });
    if (!updated.length) throw new ConflictError('This booking changed. Please reload.');
    await recordAudit(tx, {
      actor: me,
      action: 'booking.waitlist_left',
      entityType: 'booking_dog',
      entityId: bd.id,
      metadata: { by: 'customer' },
    });
  });
  return { left: true };
}

/**
 * Customer withdraws one requested day (no charge, D79). If it was the last day still waiting, the
 * whole request is withdrawn (the customer gets the standard "withdrawn" email).
 */
export async function withdrawRequestedDay(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const me = asUser(actor);
  const { bd } = await loadMyBookingDog(db, me, rawId);
  if (bd.status !== 'requested') throw new ConflictError('This day isn’t waiting for approval.');
  const req = await pendingRequestFor(db, bd.bookingId);
  if (req && (await requestedLeft(db, bd.bookingId)) === 1) {
    await withdrawMyApprovalRequest(db, me, req.id, now);
    return { withdrawn: 'request' as const };
  }
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(bookingDogs)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: me.userId,
        lateCancellation: false,
        version: bd.version + 1,
      })
      .where(and(eq(bookingDogs.id, bd.id), eq(bookingDogs.version, bd.version), eq(bookingDogs.status, 'requested')))
      .returning({ id: bookingDogs.id });
    if (!updated.length) throw new ConflictError('This booking changed. Please reload.');
    await recordAudit(tx, {
      actor: me,
      action: 'booking.request_day_withdrawn',
      entityType: 'booking_dog',
      entityId: bd.id,
    });
  });
  return { withdrawn: 'day' as const };
}
