import 'server-only';
import { raiseRefundRequests } from './billing';
import { submitPendingRefunds } from './card-refunds';
import {
  CUSTOMER_HOLD_MINUTES,
  holdUntil,
  refundBookingDayTx,
  releaseBookingHold,
  startBookingCheckout,
} from './payments';
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
import { addDays, londonDate, type IsoDate } from '@/domain/time';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { idOrNotFound, isoDate, optionalText, parseInput } from '../validation';
import { asUser, getMyCustomer, isProfileComplete } from './customers';
import { evaluateDogs } from './compliance-facts';
import { allBlocks, blocksForEvaluation } from '@/domain/compliance/attendance';
import { closuresBetween, consume, daysOverview, describeSession, loadSettings, lockDays } from './booking-shared';
import { loadPricingContext, priceWith, writeSnapshot } from './pricing';
import type { Price } from '@/domain/pricing/engine';
import { appUrl, firstNameOf, sendSafely } from '../notify';
import { bookingCancelledMessage, bookingSummaryMessage, type BookingLine } from '@/infra/email/templates';

/** The customer's dogs with whether each can book, and vaccination expiry facts for per-date checks. */
export async function myBookableDogs(db: Db, actor: Actor) {
  const customer = await getMyCustomer(db, actor);
  const rows = await db
    .select({ id: dogs.id, name: dogs.name, transport: dogPermissions.transport })
    .from(dogs)
    .leftJoin(dogPermissions, eq(dogPermissions.dogId, dogs.id))
    .where(and(eq(dogs.customerId, customer.id), isNull(dogs.archivedAt)))
    .orderBy(asc(dogs.createdAt));
  const evals = await evaluateDogs(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const e = evals.get(r.id)!;
    return {
      id: r.id,
      name: r.name,
      taxiAllowed: Boolean(r.transport),
      canBook: e.canBook,
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
          inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'waitlisted', 'offered']),
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
  session: z.enum(['full', 'am', 'pm'], { message: 'Choose full day, morning or afternoon' }),
  taxi: z.boolean(),
  ifFull: z.enum(['waitlist', 'skip']).default('waitlist'),
  customerNote: optionalText(500),
});

export type BookingOutcome = {
  dogId: string;
  dogName: string;
  date: IsoDate;
  outcome: 'confirmed' | 'waitlisted' | 'skipped';
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
  for (const dog of chosen) {
    if (!dog.canBook)
      fields.dogIds = `${dog.name} can’t be booked yet: ${dog.blockers[0] ?? 'please finish onboarding'}`;
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
      if (block) fields.dates = `${dog.name} on ${date}: ${block}`;
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
        inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'waitlisted', 'offered', 'attended', 'no_show']),
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
      const price = priceWith(ctx, { dogId: dog.id, date, session, taxi: d.taxi, dogIndexOnDate: idx });
      const reason = f.reason === 'taxi_full' ? 'Taxi is full' : 'Full';
      if (f.ok) {
        consume(used, session, d.taxi);
        idx++;
        lines.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'confirmed', price });
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
    totalPence: lines.filter((l) => l.outcome === 'confirmed').reduce((sum, l) => sum + (l.price?.totalPence ?? 0), 0),
    freeCancellationHours: settings.freeCancellationHours,
  };
}

/**
 * Customer books one or more dogs on one or more dates. All places are reserved in a single
 * transaction that locks each day's row first, so two people can never take the same last place.
 */
export async function createMyBookings(db: Db, actor: Actor, input: unknown, now = new Date()) {
  const { d, me, customer, settings, session, dates, chosen } = await validateRequest(db, actor, input, now);

  const outcomes: BookingOutcome[] = [];
  const ctx = await loadPricingContext(db, customer.id, dates[0]!, dates.at(-1)!);
  // Priced places are held while the customer pays (D6); free ones are confirmed straight away.
  const hold = holdUntil(now, CUSTOMER_HOLD_MINUTES);
  let bookingId = '';
  await db.transaction(async (tx) => {
    const days = await lockDays(tx, dates, settings, now);
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
          inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'waitlisted', 'offered', 'attended', 'no_show']),
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
        };
        const price = priceWith(ctx, { dogId: dog.id, date, session, taxi: d.taxi, dogIndexOnDate: idx });
        const reason = f.reason === 'taxi_full' ? 'Taxi is full' : 'Full';
        if (f.ok) {
          consume(day.used, session, d.taxi);
          idx++;
          toInsert.push(
            price.totalPence > 0
              ? { ...base, status: 'pending_payment', offerExpiresAt: hold }
              : { ...base, status: 'confirmed' },
          );
          prices.push(price);
          outcomes.push({ dogId: dog.id, dogName: dog.name, date, outcome: 'confirmed', price });
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
    if (toInsert.length) {
      const ids = await tx.insert(bookingDogs).values(toInsert).returning({ id: bookingDogs.id });
      for (let i = 0; i < ids.length; i++) await writeSnapshot(tx, ids[i]!.id, prices[i]!);
    }
    await recordAudit(tx, {
      actor: me,
      action: 'booking.created',
      entityType: 'booking',
      entityId: booking!.id,
      metadata: {
        confirmed: outcomes.filter((o) => o.outcome === 'confirmed').length,
        waitlisted: outcomes.filter((o) => o.outcome === 'waitlisted').length,
        skipped: outcomes.filter((o) => o.outcome === 'skipped').length,
        session,
        taxi: d.taxi,
      },
    });
  });

  const checkout = await startBookingCheckout(
    db,
    { bookingId, customerId: customer.id, createdBy: me.userId, expiresAt: hold },
    now,
  );
  // With a payment to make, the confirmation email follows the payment; only waitlist places are emailed now.
  const booked = outcomes.filter((o) => (checkout ? o.outcome === 'waitlisted' : o.outcome !== 'skipped'));
  if (booked.length) {
    const lines: BookingLine[] = booked.map((o) => ({
      dogName: o.dogName,
      ...describeSession(o.date, session),
      outcome: o.outcome === 'confirmed' ? 'booked' : 'on the waitlist',
    }));
    const who = await contactOf(db, me.userId);
    await sendSafely(bookingSummaryMessage(who.email, firstNameOf(who.name), lines, appUrl('/account/bookings')));
  }
  return {
    outcomes,
    totalPence: outcomes
      .filter((o) => o.outcome === 'confirmed')
      .reduce((sum, o) => sum + (o.price?.totalPence ?? 0), 0),
    checkoutUrl: checkout?.url ?? null,
    holdUntil: checkout ? hold : null,
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
        inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'attended', 'offered']),
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
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .leftJoin(priceSnapshots, eq(priceSnapshots.bookingDogId, bookingDogs.id))
    .where(and(eq(bookingDogs.customerId, customer.id), gte(bookingDogs.serviceDate, addDays(today, -30))))
    .orderBy(asc(bookingDogs.serviceDate), asc(dogs.name));
  const withTerms = rows.map((r) => ({
    ...r,
    offerLive: r.status === 'offered' && r.offerExpiresAt !== null && r.offerExpiresAt > now,
    cancellable: ['confirmed', 'pending_payment', 'waitlisted', 'offered'].includes(r.status) && r.serviceDate > today,
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
  if (!['confirmed', 'pending_payment', 'waitlisted', 'offered'].includes(bd.status))
    throw new ConflictError('This booking can’t be cancelled.');
  if (bd.serviceDate <= today) throw new ConflictError('Bookings for today can’t be cancelled online. Please call us.');
  if (bd.status === 'pending_payment') {
    // Not paid yet: cancelling releases every place held for that payment.
    await releaseBookingHold(db, bd.bookingId, 'Cancelled by the customer before paying', now);
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
 * Customer accepts a waitlist offer while it's still held for them. Membership days are billed on
 * the monthly invoice; any other priced day is held for payment (D6) and the checkout URL returned.
 */
export async function acceptOffer(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const me = asUser(actor);
  const { bd } = await loadMyBookingDog(db, me, rawId);
  if (bd.status !== 'offered') throw new ConflictError('There’s no offer to accept for this booking.');
  if (!bd.offerExpiresAt || bd.offerExpiresAt <= now) throw new ConflictError('Sorry, this offer has lapsed.');
  // Vaccinations are checked again when a waitlist place is taken up (D40, D73, D74).
  const e = (await evaluateDogs(db, [bd.dogId], now)).get(bd.dogId);
  const [block] = e ? allBlocks(blocksForEvaluation(e, bd.serviceDate)) : [];
  if (block) throw new ConflictError(`This place can’t be accepted yet: ${block}`);
  const [snap] = await db
    .select({ totalPence: priceSnapshots.totalPence })
    .from(priceSnapshots)
    .where(eq(priceSnapshots.bookingDogId, bd.id));
  const needsPayment = bd.kind !== 'membership' && (snap?.totalPence ?? 0) > 0;
  const hold = holdUntil(now, CUSTOMER_HOLD_MINUTES);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(bookingDogs)
      .set(
        needsPayment
          ? { status: 'pending_payment', offerExpiresAt: hold, version: bd.version + 1 }
          : { status: 'confirmed', offerExpiresAt: null, version: bd.version + 1 },
      )
      .where(and(eq(bookingDogs.id, bd.id), eq(bookingDogs.version, bd.version), eq(bookingDogs.status, 'offered')))
      .returning({ id: bookingDogs.id });
    if (!updated.length) throw new ConflictError('This booking changed. Please reload.');
    await recordAudit(tx, { actor: me, action: 'booking.offer_accepted', entityType: 'booking_dog', entityId: bd.id });
  });
  if (!needsPayment) return { checkoutUrl: null };
  const checkout = await startBookingCheckout(
    db,
    { bookingId: bd.bookingId, customerId: bd.customerId, createdBy: me.userId, expiresAt: hold },
    now,
  );
  return { checkoutUrl: checkout?.url ?? null };
}
