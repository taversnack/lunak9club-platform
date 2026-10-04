import 'server-only';
import { raiseRefundRequests } from './billing';
import { submitPendingRefunds } from './card-refunds';
import {
  ownerHoldUntil,
  refundBookingDayTx,
  releaseBookingHold,
  sessionStartInstant,
  startBookingCheckout,
} from './payments';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import {
  bookingDogs,
  bookings,
  bookingSettings,
  closures,
  contacts,
  customers,
  dogs,
  serviceDays,
  users,
  vets,
} from '@/infra/db/schema';
import {
  checkBookableDate,
  fits,
  isoWeekday,
  remainingFor,
  vaccinationBlockForDate,
  type Session,
} from '@/domain/booking/rules';
import { addDays, isIsoDate, londonDate, type IsoDate } from '@/domain/time';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { checkbox, idOrNotFound, isoDate, optionalText, parseInput, requiredText } from '../validation';
import { evaluateDogs } from './compliance-facts';
import { loadPricingContext, priceWith, writeSnapshot } from './pricing';
import { closuresBetween, consume, daysOverview, describeSession, loadSettings, lockDays } from './booking-shared';
import { appUrl, firstNameOf, sendSafely } from '../notify';
import { bookingCancelledMessage, bookingSummaryMessage, waitlistOfferMessage } from '@/infra/email/templates';

/** Owner: one day — capacity, every dog booked, taxi list, waitlist and compliance warnings. */
export async function ownerDay(db: Db, actor: Actor, date: IsoDate, now = new Date()) {
  assertAuthorized(actor, 'bookings.manage');
  const settings = await loadSettings(db);
  const [overview, closed, rows] = await Promise.all([
    daysOverview(db, [date], settings, now),
    closuresBetween(db, date, date),
    db
      .select({
        id: bookingDogs.id,
        session: bookingDogs.session,
        taxi: bookingDogs.taxi,
        status: bookingDogs.status,
        offerExpiresAt: bookingDogs.offerExpiresAt,
        checkedInAt: bookingDogs.checkedInAt,
        checkedOutAt: bookingDogs.checkedOutAt,
        customerNote: bookingDogs.customerNote,
        internalNote: bookingDogs.internalNote,
        kind: bookingDogs.kind,
        overrideReason: bookingDogs.overrideReason,
        lateCancellation: bookingDogs.lateCancellation,
        version: bookingDogs.version,
        createdAt: bookingDogs.createdAt,
        dogId: dogs.id,
        dogName: dogs.name,
        customerId: customers.id,
        customerName: users.name,
        customerPhone: customers.phone,
        postcode: customers.postcode,
        addressLine1: customers.addressLine1,
        town: customers.town,
      })
      .from(bookingDogs)
      .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
      .innerJoin(customers, eq(customers.id, bookingDogs.customerId))
      .innerJoin(users, eq(users.id, customers.userId))
      .where(eq(bookingDogs.serviceDate, date))
      .orderBy(asc(dogs.name)),
  ]);
  const evals = await evaluateDogs(db, [...new Set(rows.map((r) => r.dogId))], now);
  const withWarnings = rows.map((r) => {
    const e = evals.get(r.dogId);
    const vacc = e
      ? vaccinationBlockForDate(
          e.items.filter((i) => i.kind === 'vaccination'),
          date,
        )
      : null;
    const warning = !e ? null : (vacc ?? (e.canBook ? null : (e.bookingBlockers[0] ?? null)));
    return {
      ...r,
      warning,
      offerLive:
        (r.status === 'offered' || r.status === 'pending_payment') && !!r.offerExpiresAt && r.offerExpiresAt > now,
    };
  });
  const o = overview.get(date)!;
  return {
    date,
    closedReason: closed.get(date) ?? (settings.openWeekdays.includes(isoWeekday(date)) ? null : 'Not an opening day'),
    capacity: o.cap,
    used: o.used,
    left: {
      am: remainingFor('am', o.used, o.cap),
      pm: remainingFor('pm', o.used, o.cap),
      taxi: o.cap.taxi - o.used.taxi,
    },
    booked: withWarnings.filter(
      (r) =>
        ['confirmed', 'attended', 'no_show'].includes(r.status) ||
        ((r.status === 'offered' || r.status === 'pending_payment') && r.offerLive),
    ),
    waitlist: withWarnings
      .filter((r) => r.status === 'waitlisted' || (r.status === 'offered' && !r.offerLive))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    cancelled: withWarnings.filter((r) => r.status === 'cancelled'),
    taxi: withWarnings.filter((r) => r.taxi && ['confirmed', 'attended'].includes(r.status)),
  };
}

/** Owner: counts per day for a date range (week and month views). */
export async function ownerRange(db: Db, actor: Actor, from: IsoDate, days: number, now = new Date()) {
  assertAuthorized(actor, 'bookings.manage');
  const settings = await loadSettings(db);
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const [overview, closed] = await Promise.all([
    daysOverview(db, dates, settings, now),
    closuresBetween(db, dates[0]!, dates.at(-1)!),
  ]);
  return dates.map((date) => {
    const o = overview.get(date)!;
    const open = settings.openWeekdays.includes(isoWeekday(date)) && !closed.has(date);
    return {
      date,
      open,
      closedReason: closed.get(date) ?? null,
      ...o,
      left: { am: remainingFor('am', o.used, o.cap), pm: remainingFor('pm', o.used, o.cap) },
    };
  });
}

async function loadBookingDog(db: Db, rawId: string) {
  const id = idOrNotFound(rawId, 'Booking');
  const [row] = await db
    .select({ bd: bookingDogs, dogName: dogs.name, email: users.email, name: users.name })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .innerJoin(customers, eq(customers.id, bookingDogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(bookingDogs.id, id));
  if (!row) throw new NotFoundError('Booking');
  return row;
}

const Version = z.object({ version: z.coerce.number().int().positive() });

async function transition(
  db: Db,
  actor: Actor,
  rawId: string,
  input: unknown,
  fn: (bd: typeof bookingDogs.$inferSelect, today: IsoDate) => Partial<typeof bookingDogs.$inferInsert>,
  action: string,
  now = new Date(),
) {
  assertAuthorized(actor, 'attendance.manage');
  const { version } = parseInput(Version, input);
  const { bd } = await loadBookingDog(db, rawId);
  if (bd.version !== version) throw new ConflictError('This booking changed. Please reload.');
  const changes = fn(bd, londonDate(now));
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(bookingDogs)
      .set({ ...changes, attendanceBy: actor.kind === 'user' ? actor.userId : null, version: bd.version + 1 })
      .where(and(eq(bookingDogs.id, bd.id), eq(bookingDogs.version, bd.version)))
      .returning({ id: bookingDogs.id });
    if (!updated.length) throw new ConflictError('This booking changed. Please reload.');
    await recordAudit(tx, { actor, action, entityType: 'booking_dog', entityId: bd.id });
  });
}

export const checkIn = (db: Db, actor: Actor, id: string, input: unknown, now = new Date()) =>
  transition(
    db,
    actor,
    id,
    input,
    (bd, today) => {
      if (bd.status !== 'confirmed') throw new ConflictError('Only booked dogs can be checked in.');
      if (bd.serviceDate > today) throw new ConflictError('You can check dogs in on the day.');
      return { status: 'attended', checkedInAt: now };
    },
    'attendance.checked_in',
    now,
  );

export const checkOut = (db: Db, actor: Actor, id: string, input: unknown, now = new Date()) =>
  transition(
    db,
    actor,
    id,
    input,
    (bd) => {
      if (bd.status !== 'attended' || !bd.checkedInAt) throw new ConflictError('Check the dog in first.');
      if (bd.checkedOutAt) throw new ConflictError('Already checked out.');
      return { checkedOutAt: now };
    },
    'attendance.checked_out',
    now,
  );

export const markNoShow = (db: Db, actor: Actor, id: string, input: unknown, now = new Date()) =>
  transition(
    db,
    actor,
    id,
    input,
    (bd, today) => {
      if (bd.status !== 'confirmed')
        throw new ConflictError('Only booked dogs that haven’t arrived can be marked as no-show.');
      if (bd.serviceDate > today) throw new ConflictError('You can mark no-shows on the day.');
      return { status: 'no_show' };
    },
    'attendance.no_show',
    now,
  );

export const undoAttendance = (db: Db, actor: Actor, id: string, input: unknown, now = new Date()) =>
  transition(
    db,
    actor,
    id,
    input,
    (bd) => {
      if (bd.status !== 'attended' && bd.status !== 'no_show') throw new ConflictError('Nothing to undo.');
      return { status: 'confirmed', checkedInAt: null, checkedOutAt: null };
    },
    'attendance.undone',
    now,
  );

/** Owner offers a waitlisted place; it's held for waitlistOfferHours (D41). */
export async function offerPlace(db: Db, actor: Actor, rawId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'bookings.manage');
  const { version } = parseInput(Version, input);
  const settings = await loadSettings(db);
  const row = await loadBookingDog(db, rawId);
  const { bd } = row;
  const expires = new Date(now.getTime() + settings.waitlistOfferHours * 3_600_000);
  await db.transaction(async (tx) => {
    const days = await lockDays(tx, [bd.serviceDate], settings, now);
    const [fresh] = await tx.select().from(bookingDogs).where(eq(bookingDogs.id, bd.id)).for('update');
    if (!fresh || fresh.version !== version) throw new ConflictError('This booking changed. Please reload.');
    const lapsedOffer = fresh.status === 'offered' && (!fresh.offerExpiresAt || fresh.offerExpiresAt <= now);
    if (fresh.status !== 'waitlisted' && !lapsedOffer)
      throw new ConflictError('Only waitlisted bookings can be offered a place.');
    const day = days.get(bd.serviceDate)!;
    const f = fits(fresh.session, fresh.taxi, day.used, day.cap);
    if (!f.ok)
      throw new ConflictError(
        f.reason === 'taxi_full' ? 'The taxi is full on this day.' : 'There’s no free place for this session yet.',
      );
    await tx
      .update(bookingDogs)
      .set({ status: 'offered', offerExpiresAt: expires, version: fresh.version + 1 })
      .where(eq(bookingDogs.id, bd.id));
    await recordAudit(tx, { actor, action: 'booking.place_offered', entityType: 'booking_dog', entityId: bd.id });
  });
  await sendSafely(
    waitlistOfferMessage(
      row.email,
      firstNameOf(row.name),
      { dogName: row.dogName, ...describeSession(bd.serviceDate, bd.session), outcome: 'place offered' },
      settings.waitlistOfferHours,
      appUrl('/account/bookings'),
    ),
  );
}

export const OwnerCancelInput = z.object({
  version: z.coerce.number().int().positive(),
  charge: checkbox,
  reason: requiredText('a reason', 300),
});

/** Owner cancels a booking; not charged unless they choose to (D39). The customer is emailed. */
export async function ownerCancel(db: Db, actor: Actor, rawId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'bookings.manage');
  const d = parseInput(OwnerCancelInput, input);
  const row = await loadBookingDog(db, rawId);
  const { bd } = row;
  if (!['confirmed', 'pending_payment', 'waitlisted', 'offered'].includes(bd.status))
    throw new ConflictError('This booking can’t be cancelled.');
  if (bd.status === 'pending_payment') {
    await releaseBookingHold(db, bd.bookingId, `Cancelled by Luna’s K9 Club before payment: ${d.reason}`, now);
    await recordAudit(db, { actor, action: 'booking.hold_cancelled', entityType: 'booking_dog', entityId: bd.id });
    return;
  }
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(bookingDogs)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelledBy: actor.kind === 'user' ? actor.userId : null,
        lateCancellation: d.charge,
        internalNote: [bd.internalNote, `Cancelled: ${d.reason}`].filter(Boolean).join('\n'),
        version: bd.version + 1,
      })
      .where(and(eq(bookingDogs.id, bd.id), eq(bookingDogs.version, d.version)))
      .returning({ id: bookingDogs.id });
    if (!updated.length) throw new ConflictError('This booking changed. Please reload.');
    if (!d.charge) {
      await raiseRefundRequests(tx, { bookingDogIds: [bd.id] });
      await refundBookingDayTx(tx, bd.id, `Cancelled by Luna’s K9 Club: ${row.dogName}`, now);
    }
    await recordAudit(tx, {
      actor,
      action: 'booking.cancelled',
      entityType: 'booking_dog',
      entityId: bd.id,
      metadata: { late: d.charge, by: 'owner', from: bd.status },
    });
  });
  await submitPendingRefunds(db);
  await sendSafely(
    bookingCancelledMessage(
      row.email,
      firstNameOf(row.name),
      { dogName: row.dogName, ...describeSession(bd.serviceDate, bd.session), outcome: 'cancelled by Luna’s K9 Club' },
      appUrl('/account/bookings'),
    ),
  );
}

export const NoteInput = z.object({ version: z.coerce.number().int().positive(), internalNote: optionalText(1000) });

export async function setInternalNote(db: Db, actor: Actor, rawId: string, input: unknown) {
  assertAuthorized(actor, 'bookings.manage');
  const d = parseInput(NoteInput, input);
  const { bd } = await loadBookingDog(db, rawId);
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(bookingDogs)
      .set({ internalNote: d.internalNote, version: bd.version + 1 })
      .where(and(eq(bookingDogs.id, bd.id), eq(bookingDogs.version, d.version)))
      .returning({ id: bookingDogs.id });
    if (!updated.length) throw new ConflictError('This booking changed. Please reload.');
    await recordAudit(tx, { actor, action: 'booking.note_updated', entityType: 'booking_dog', entityId: bd.id });
  });
}

export const OwnerBookingInput = z.object({
  dogId: z.string(),
  date: isoDate('the date'),
  session: z.enum(['full', 'am', 'pm'], { message: 'Choose a session' }),
  taxi: checkbox,
  overrideReason: optionalText(300),
  trial: checkbox,
  trialBand: z.enum(['ad_hoc', 'low', 'high']).default('ad_hoc'),
});

/** Owner books a dog (e.g. a trial day). Needs a reason to override onboarding, closures or capacity (D42). */
export async function ownerCreateBooking(db: Db, actor: Actor, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'bookings.manage');
  const d = parseInput(OwnerBookingInput, input);
  const dogId = idOrNotFound(d.dogId, 'Dog');
  const session = d.session as Session;
  const settings = await loadSettings(db);
  const today = londonDate(now);
  if (d.date < today)
    throw new ValidationError('Please check the highlighted fields.', { date: 'Choose today or a future date' });
  const [dog] = await db
    .select({ id: dogs.id, name: dogs.name, customerId: dogs.customerId, email: users.email, name2: users.name })
    .from(dogs)
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(dogs.id, dogId));
  if (!dog) throw new NotFoundError('Dog');

  const problems: string[] = [];
  const e = (await evaluateDogs(db, [dogId], now)).get(dogId)!;
  // A trial day is the expected way to book a dog that isn't approved yet (D21), so it isn't an override.
  if (!e.canBook && !d.trial) problems.push(e.bookingBlockers[0] ?? 'Dog is not approved');
  const vacc = vaccinationBlockForDate(
    e.items.filter((i) => i.kind === 'vaccination'),
    d.date,
  );
  if (vacc) problems.push(vacc);
  const closed = await closuresBetween(db, d.date, d.date);
  // The Owner may book today and beyond the customer booking window; closures and closed weekdays still need a reason.
  const c = checkBookableDate({
    date: d.date,
    today: addDays(today, -1),
    settings: { ...settings, maxAdvanceDays: 3650 },
    closedReason: closed.get(d.date),
  });
  if (!c.ok) problems.push(c.reason);

  const hold = ownerHoldUntil(now, sessionStartInstant(settings, d.date, session));
  let bookingId = '';
  let pricePence = 0;
  const id = await db.transaction(async (tx) => {
    const day = (await lockDays(tx, [d.date], settings, now)).get(d.date)!;
    const [dup] = await tx
      .select({ id: bookingDogs.id })
      .from(bookingDogs)
      .where(
        and(
          eq(bookingDogs.dogId, dogId),
          eq(bookingDogs.serviceDate, d.date),
          inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'waitlisted', 'offered', 'attended', 'no_show']),
        ),
      );
    if (dup) throw new ConflictError(`${dog.name} is already booked on this day.`);
    const f = fits(session, d.taxi, day.used, day.cap);
    if (!f.ok) problems.push(f.reason === 'taxi_full' ? 'Taxi is full' : 'Session is full');
    if (problems.length && !d.overrideReason) {
      throw new ValidationError(`Needs a reason to override: ${problems.join('; ')}`, {
        overrideReason: `Give a reason to override: ${problems.join('; ')}`,
      });
    }
    consume(day.used, session, d.taxi);
    const [b] = await tx
      .insert(bookings)
      .values({
        customerId: dog.customerId,
        createdBy: actor.kind === 'user' ? actor.userId : 'system',
        source: 'owner',
      })
      .returning({ id: bookings.id });
    const ctx = await loadPricingContext(tx, dog.customerId, d.date, d.date);
    const price = priceWith(ctx, {
      dogId,
      date: d.date,
      session,
      taxi: d.taxi,
      dogIndexOnDate: 0,
      isTrial: d.trial,
      trialBand: d.trialBand === 'ad_hoc' ? null : d.trialBand,
    });
    pricePence = price.totalPence;
    bookingId = b!.id;
    // Paid at booking (D6): the customer is emailed a payment link and the place is held (D59).
    const [bdRow] = await tx
      .insert(bookingDogs)
      .values({
        bookingId: b!.id,
        customerId: dog.customerId,
        dogId,
        serviceDate: d.date,
        session,
        taxi: d.taxi,
        status: price.totalPence > 0 ? 'pending_payment' : 'confirmed',
        offerExpiresAt: price.totalPence > 0 ? hold : null,
        kind: d.trial ? 'trial' : 'standard',
        overrideReason: problems.length ? d.overrideReason : null,
      })
      .returning({ id: bookingDogs.id });
    await writeSnapshot(tx, bdRow!.id, price);
    await recordAudit(tx, {
      actor,
      action: problems.length ? 'booking.created_with_override' : 'booking.created',
      entityType: 'booking_dog',
      entityId: bdRow!.id,
      metadata: { by: 'owner', overrides: problems.length },
    });
    return bdRow!.id;
  });
  if (pricePence > 0) {
    await startBookingCheckout(
      db,
      {
        bookingId,
        customerId: dog.customerId,
        createdBy: actor.kind === 'user' ? actor.userId : null,
        expiresAt: hold,
        notifyByEmail: true,
      },
      now,
    );
    return id;
  }
  await sendSafely(
    bookingSummaryMessage(
      dog.email,
      firstNameOf(dog.name2),
      [{ dogName: dog.name, ...describeSession(d.date, session), outcome: 'booked by Luna’s K9 Club' }],
      appUrl('/account/bookings'),
    ),
  );
  return id;
}

export const DayCapacityInput = z.object({
  date: isoDate('the date'),
  sessionCapacity: z.coerce.number().int().min(0).max(200),
  taxiCapacity: z.coerce.number().int().min(0).max(200),
  note: optionalText(300),
});

/** Owner changes capacity for one day. Can't go below places already taken. */
export async function setDayCapacity(db: Db, actor: Actor, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'availability.manage');
  const d = parseInput(DayCapacityInput, input);
  const settings = await loadSettings(db);
  await db.transaction(async (tx) => {
    const day = (await lockDays(tx, [d.date], settings, now)).get(d.date)!;
    const inUse = Math.max(day.used.am, day.used.pm);
    if (d.sessionCapacity < inUse)
      throw new ValidationError('Please check the highlighted fields.', {
        sessionCapacity: `${inUse} places are already booked in the busiest session`,
      });
    if (d.taxiCapacity < day.used.taxi)
      throw new ValidationError('Please check the highlighted fields.', {
        taxiCapacity: `${day.used.taxi} taxi places are already booked`,
      });
    await tx
      .update(serviceDays)
      .set({ sessionCapacity: d.sessionCapacity, taxiCapacity: d.taxiCapacity, note: d.note })
      .where(eq(serviceDays.serviceDate, d.date));
    await recordAudit(tx, {
      actor,
      action: 'availability.day_capacity_set',
      entityType: 'service_day',
      entityId: d.date,
      metadata: { sessionCapacity: d.sessionCapacity, taxiCapacity: d.taxiCapacity },
    });
  });
}

export const ClosureInput = z.object({ date: isoDate('the date'), reason: requiredText('a reason', 120) });

export async function addClosure(db: Db, actor: Actor, input: unknown) {
  assertAuthorized(actor, 'availability.manage');
  const d = parseInput(ClosureInput, input);
  const live = await db
    .select({ id: bookingDogs.id })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.serviceDate, d.date),
        inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'offered', 'waitlisted']),
      ),
    );
  if (live.length)
    throw new ConflictError(`There are ${live.length} bookings on this day. Cancel them first, then close the day.`);
  await db.transaction(async (tx) => {
    const ins = await tx
      .insert(closures)
      .values({ serviceDate: d.date, reason: d.reason, createdBy: actor.kind === 'user' ? actor.userId : null })
      .onConflictDoNothing()
      .returning({ d: closures.serviceDate });
    if (!ins.length) throw new ConflictError('That day is already closed.');
    await recordAudit(tx, { actor, action: 'availability.closure_added', entityType: 'closure', entityId: d.date });
  });
}

export async function removeClosure(db: Db, actor: Actor, date: string) {
  assertAuthorized(actor, 'availability.manage');
  if (!isIsoDate(date)) throw new NotFoundError('Closure');
  await db.transaction(async (tx) => {
    const del = await tx.delete(closures).where(eq(closures.serviceDate, date)).returning({ d: closures.serviceDate });
    if (!del.length) throw new NotFoundError('Closure');
    await recordAudit(tx, { actor, action: 'availability.closure_removed', entityType: 'closure', entityId: date });
  });
}

export async function listClosures(db: Db, actor: Actor, from: IsoDate) {
  assertAuthorized(actor, 'availability.manage');
  return db.select().from(closures).where(gte(closures.serviceDate, from)).orderBy(asc(closures.serviceDate)).limit(60);
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 07:30');
export const SettingsInput = z
  .object({
    sessionCapacity: z.coerce.number().int().min(0).max(200),
    taxiCapacity: z.coerce.number().int().min(0).max(200),
    fullDayStart: time,
    fullDayEnd: time,
    morningStart: time,
    morningEnd: time,
    afternoonStart: time,
    afternoonEnd: time,
    maxAdvanceDays: z.coerce.number().int().min(1).max(365),
    freeCancellationHours: z.coerce.number().int().min(0).max(336),
    waitlistOfferHours: z.coerce.number().int().min(1).max(72),
    openWeekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, 'Choose at least one opening day'),
  })
  .refine((s) => s.fullDayStart < s.fullDayEnd && s.morningStart < s.morningEnd && s.afternoonStart < s.afternoonEnd, {
    message: 'Each session must end after it starts',
    path: ['fullDayEnd'],
  });

export async function updateBookingSettings(db: Db, actor: Actor, input: unknown) {
  assertAuthorized(actor, 'availability.manage');
  const d = parseInput(SettingsInput, input);
  await db.transaction(async (tx) => {
    await tx
      .update(bookingSettings)
      .set({ ...d, openWeekdays: [...new Set(d.openWeekdays)].sort() })
      .where(eq(bookingSettings.id, 1));
    await recordAudit(tx, {
      actor,
      action: 'availability.settings_updated',
      entityType: 'booking_settings',
      entityId: '1',
      metadata: { sessionCapacity: d.sessionCapacity, taxiCapacity: d.taxiCapacity },
    });
  });
}

export async function ownerBookableDogs(db: Db, actor: Actor) {
  assertAuthorized(actor, 'bookings.manage');
  return db
    .select({ id: dogs.id, name: dogs.name, customerName: users.name, status: dogs.status })
    .from(dogs)
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .orderBy(asc(dogs.name))
    .limit(500);
}

// ---- CSV exports (D35) -------------------------------------------------------

/** Escape a CSV cell and neutralise spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export async function attendanceCsv(db: Db, actor: Actor, date: IsoDate) {
  assertAuthorized(actor, 'exports.read');
  const day = await ownerDay(db, actor, date);
  await recordAudit(db, { actor, action: 'export.attendance', entityType: 'service_day', entityId: date });
  const fmt = (d: Date | null) =>
    d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeStyle: 'short' }).format(d) : '';
  return csv([
    ['Date', 'Dog', 'Customer', 'Phone', 'Session', 'Taxi', 'Status', 'Checked in', 'Checked out', 'Warning'],
    ...day.booked.map((r) => [
      date,
      r.dogName,
      r.customerName,
      r.customerPhone,
      r.session,
      r.taxi ? 'Yes' : 'No',
      r.status,
      fmt(r.checkedInAt),
      fmt(r.checkedOutAt),
      r.warning ?? '',
    ]),
  ]);
}

/** Emergency list for the day: dogs present, owner phone, emergency contacts and vet. Contains personal data — audited. */
export async function emergencyCsv(db: Db, actor: Actor, date: IsoDate) {
  assertAuthorized(actor, 'exports.read');
  assertAuthorized(actor, 'dogs.read_sensitive');
  const day = await ownerDay(db, actor, date);
  const customerIds = [...new Set(day.booked.map((r) => r.customerId))];
  const dogIds = [...new Set(day.booked.map((r) => r.dogId))];
  const [cs, vs] = await Promise.all([
    customerIds.length
      ? db
          .select()
          .from(contacts)
          .where(and(inArray(contacts.customerId, customerIds), eq(contacts.isEmergencyContact, true)))
      : Promise.resolve([]),
    dogIds.length
      ? db
          .select({ dogId: dogs.id, practice: vets.practiceName, phone: vets.phone })
          .from(dogs)
          .innerJoin(vets, eq(vets.id, dogs.vetId))
          .where(inArray(dogs.id, dogIds))
      : Promise.resolve([]),
  ]);
  await recordAudit(db, { actor, action: 'export.emergency_list', entityType: 'service_day', entityId: date });
  return csv([
    ['Date', 'Dog', 'Customer', 'Customer phone', 'Emergency contacts', 'Vet', 'Vet phone'],
    ...day.booked.map((r) => {
      const v = vs.find((x) => x.dogId === r.dogId);
      return [
        date,
        r.dogName,
        r.customerName,
        r.customerPhone,
        cs
          .filter((c) => c.customerId === r.customerId)
          .map((c) => `${c.name} ${c.phone}`)
          .join('; '),
        v?.practice ?? '',
        v?.phone ?? '',
      ];
    }),
  ]);
}
