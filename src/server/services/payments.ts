import 'server-only';
import { and, asc, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import {
  approvalRequests,
  bookingDogs,
  bookings,
  checkoutAttemptDays,
  checkoutAttempts,
  customers,
  dogs,
  invoiceLines,
  invoices,
  payments,
  priceSnapshots,
  users,
  webhookEvents,
} from '@/infra/db/schema';
import { getPaymentProvider } from '@/infra/payments';
import { holdReleasedMessage, paymentLinkMessage, paymentReceivedMessage } from '@/infra/email/templates';
import { fits, sessionTimes, type Session } from '@/domain/booking/rules';
import { lineDescription, monthOf } from '@/domain/billing/rules';
import { pounds } from '@/domain/pricing/engine';
import { londonDate, londonInstant } from '@/domain/time';
import { formatDateTimeLondon } from '@/ui/format';
import { logger } from '@/infra/logger';
import { assertAuthorized, hasPermission, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError } from '../errors';
import { appUrl, firstNameOf, sendSafely } from '../notify';
import { idOrNotFound } from '../validation';
import { asUser, getMyCustomer } from './customers';
import { loadSettings, lockDays, consume } from './booking-shared';
import { balances, createCreditNoteTx, issueTx, myInvoice, settleTx } from './billing';
import { creditNoteLines } from '@/infra/db/schema';
import { applyRefundUpdate, queueCardRefunds, submitPendingRefunds } from './card-refunds';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const SYSTEM: Actor = { kind: 'system', job: 'payments' };
const NO_ID = '00000000-0000-0000-0000-000000000000';

/** Places a customer books are held for 31 minutes while they pay (D6; Stripe's minimum is 30). */
export const CUSTOMER_HOLD_MINUTES = 31;
/** Places the Owner books are held for (almost) 24 hours, Stripe's maximum (D59). */
export const OWNER_HOLD_MINUTES = 23 * 60 + 55;

export function holdUntil(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/** Owner-made holds end at the session start if that's sooner, but never under Stripe's 30 minutes. */
export function ownerHoldUntil(now: Date, sessionStart: Date): Date {
  const max = holdUntil(now, OWNER_HOLD_MINUTES);
  const min = holdUntil(now, CUSTOMER_HOLD_MINUTES);
  const at = sessionStart < max ? sessionStart : max;
  return at < min ? min : at;
}

async function customerContact(q: Db | Tx, customerId: string) {
  const [row] = await q
    .select({ email: users.email, name: users.name, userId: users.id })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, customerId));
  if (!row) throw new NotFoundError('Customer');
  return row;
}

/** The booking days an attempt pays for; null for attempts opened before days were recorded. */
async function attemptDayIds(q: Db | Tx, attemptId: string) {
  const rows = await q
    .select({ id: checkoutAttemptDays.bookingDogId })
    .from(checkoutAttemptDays)
    .where(eq(checkoutAttemptDays.checkoutAttemptId, attemptId));
  return rows.length ? rows.map((r) => r.id) : null;
}

/** Held days on a booking, limited to `ids` when given (one checkout's days). */
async function pendingDays(q: Db | Tx, bookingId: string, ids: string[] | null) {
  return q
    .select({
      id: bookingDogs.id,
      serviceDate: bookingDogs.serviceDate,
      session: bookingDogs.session,
      taxi: bookingDogs.taxi,
      holdUntil: bookingDogs.offerExpiresAt,
      dogName: dogs.name,
      totalPence: priceSnapshots.totalPence,
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .innerJoin(priceSnapshots, eq(priceSnapshots.bookingDogId, bookingDogs.id))
    .where(
      and(
        eq(bookingDogs.bookingId, bookingId),
        eq(bookingDogs.status, 'pending_payment'),
        ids ? inArray(bookingDogs.id, ids.length ? ids : [NO_ID]) : undefined,
      ),
    )
    .orderBy(asc(bookingDogs.serviceDate), asc(dogs.name));
}

// A held day is covered by a checkout recorded for that day, or by a legacy checkout on its booking
// that recorded no days (from before checkout_attempt_days).
const coveredDay = (statusSql: ReturnType<typeof sql>) => sql`exists (select 1 from ${checkoutAttempts} c
  where c.booking_id = ${bookingDogs.bookingId} and ${statusSql}
    and (exists (select 1 from ${checkoutAttemptDays} cd where cd.checkout_attempt_id = c.id and cd.booking_dog_id = ${bookingDogs.id})
      or not exists (select 1 from ${checkoutAttemptDays} cd where cd.checkout_attempt_id = c.id)))`;

const describeDays = (days: { dogName: string }[]) => {
  const names = [...new Set(days.map((d) => d.dogName))].join(' and ');
  return `day care for ${names} (${days.length} ${days.length === 1 ? 'session' : 'sessions'})`;
};

/** Pause between tries when the payment provider can't be reached (tests set it to 0). */
export const checkoutRetry = { delayMs: 300 };

/** Another request is creating this pay link right now. Nothing failed: try again in a moment. */
export class PayLinkBusyError extends ConflictError {
  constructor() {
    super('Your payment link is being prepared. Please try again in a moment.');
    this.name = 'PayLinkBusyError';
  }
}

/** The provider couldn't create a pay link; any places stay held (the Owner can resend, the customer can retry). */
export class PayLinkUnavailableError extends ConflictError {
  constructor(untilText: string | null) {
    super(
      untilText
        ? `We couldn’t create your payment link just now. Please try again in a few minutes – your places are held until ${untilText}.`
        : 'We couldn’t create your payment link just now. Please try again in a few minutes.',
    );
    this.name = 'PayLinkUnavailableError';
  }
}

/**
 * Open a card checkout for the places held on a booking, or reuse the one already open for the
 * same amount (so a retry, a resend or a second click never makes a duplicate). Only days still
 * within their hold are charged.
 *
 * The provider is tried `tries` times. If it still can't be reached: by default the holds are
 * released so nothing is left half-booked; with `keepHoldOnFailure` (approved requests, places
 * given from the waitlist, customer "Pay now", Owner "Resend pay link") the places stay held until
 * their deadline, the failure is recorded and PayLinkUnavailableError is thrown.
 */
export async function startBookingCheckout(
  db: Db,
  opts: {
    bookingId: string;
    /** The held booking_dogs rows this checkout pays for (#8). Other held days on the booking aren't touched. */
    bookingDogIds: string[];
    customerId: string;
    createdBy: string | null;
    expiresAt: Date;
    notifyByEmail?: boolean;
    /** The email follows an approved booking request (D80): "pay to secure" wording. */
    approvedRequest?: boolean;
    tries?: number;
    keepHoldOnFailure?: boolean;
  },
  now = new Date(),
) {
  const days = (await pendingDays(db, opts.bookingId, opts.bookingDogIds)).filter(
    (d) => !d.holdUntil || d.holdUntil > now,
  );
  const dayIds = days.map((d) => d.id);
  const sameDays = (ids: string[] | null) =>
    ids !== null && ids.length === dayIds.length && ids.every((id) => dayIds.includes(id));
  const amount = days.reduce((a, d) => a + d.totalPence, 0);
  if (!days.length || amount <= 0) return null;
  const who = await customerContact(db, opts.customerId);
  const provider = getPaymentProvider();
  const description = `Luna’s K9 Club – ${describeDays(days)}`;
  const expiresAt = opts.expiresAt;
  const notify = async (attemptId: string, until: Date) => {
    if (!opts.notifyByEmail) return;
    await sendSafely(
      paymentLinkMessage(
        who.email,
        firstNameOf(who.name),
        {
          amountText: pounds(amount),
          forText: describeDays(days),
          untilText: formatDateTimeLondon(until),
          approved: opts.approvedRequest,
        },
        appUrl(`/api/payments/pay/${attemptId}`),
      ),
    );
  };

  // One live checkout per set of days (#8 scopes each checkout to its days). Serialise on the
  // booking, reuse an open checkout for exactly these days, and close any other live checkout that
  // covers one of them (it would charge the same day twice). Checkouts for other days are left alone.
  const claim = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`checkout:${opts.bookingId}`}))`);
    const live = await tx
      .select()
      .from(checkoutAttempts)
      .where(
        and(
          eq(checkoutAttempts.bookingId, opts.bookingId),
          inArray(checkoutAttempts.status, ['open', 'creating']),
          gt(checkoutAttempts.expiresAt, now),
        ),
      )
      .orderBy(desc(checkoutAttempts.createdAt));
    const stale: string[] = [];
    for (const a of live) {
      const covers = await attemptDayIds(tx, a.id); // null: an attempt from before days were recorded
      if (covers && !covers.some((id) => dayIds.includes(id))) continue;
      if (sameDays(covers) && a.amountPence === amount) {
        if (a.status === 'open' && a.url) return { reuse: a, stale };
        // Another request is creating the link for these days right now.
        if (a.status === 'creating' && a.createdAt > new Date(now.getTime() - 2 * 60_000))
          return { busy: true as const, stale };
      }
      // Overlapping, different amount, legacy or abandoned: close it without touching the holds.
      await tx
        .update(checkoutAttempts)
        .set({ status: 'expired', completedAt: now })
        .where(eq(checkoutAttempts.id, a.id));
      if (a.providerSessionId) stale.push(a.providerSessionId);
    }
    const [attempt] = await tx
      .insert(checkoutAttempts)
      .values({
        // On the caller's clock, which the 'creating' and reconcile age checks compare against.
        createdAt: now,
        purpose: 'booking',
        customerId: opts.customerId,
        bookingId: opts.bookingId,
        amountPence: amount,
        description,
        provider: provider.name,
        expiresAt,
        createdBy: opts.createdBy,
      })
      .returning();
    await tx
      .insert(checkoutAttemptDays)
      .values(dayIds.map((id) => ({ checkoutAttemptId: attempt!.id, bookingDogId: id })));
    return { attempt: attempt!, stale };
  });
  for (const sid of claim.stale) await provider.expireCheckout(sid).catch(() => undefined);
  if ('reuse' in claim && claim.reuse) {
    await notify(claim.reuse.id, claim.reuse.expiresAt);
    return { attemptId: claim.reuse.id, url: claim.reuse.url!, amountPence: amount, reused: true };
  }
  if ('busy' in claim) throw new PayLinkBusyError();
  const attempt = claim.attempt!;

  const tries = Math.max(1, opts.tries ?? 1);
  let session: { id: string; url: string } | null = null;
  let failures = 0;
  for (let i = 0; i < tries && !session; i++) {
    try {
      session = await provider.createCheckout({
        reference: attempt.id,
        amountPence: amount,
        description,
        customerEmail: who.email,
        successUrl: appUrl(`/api/payments/return?attempt=${attempt.id}`),
        cancelUrl: appUrl(`/api/payments/return?attempt=${attempt.id}&cancelled=1`),
        expiresAt,
      });
    } catch (err) {
      failures++;
      logger.warn(
        { err: err instanceof Error ? err.name : 'unknown', try: i + 1, of: tries },
        'checkout could not be started',
      );
      if (i + 1 < tries && checkoutRetry.delayMs > 0)
        await new Promise((r) => setTimeout(r, checkoutRetry.delayMs * (i + 1)));
    }
  }

  if (session) {
    await db
      .update(checkoutAttempts)
      .set({ status: 'open', providerSessionId: session.id, url: session.url })
      .where(eq(checkoutAttempts.id, attempt.id));
    await recordAudit(db, {
      actor: SYSTEM,
      action: 'payment.checkout_started',
      entityType: 'checkout_attempt',
      entityId: attempt.id,
      metadata: { purpose: 'booking', amountPence: amount, retries: failures },
    });
    await notify(attempt.id, expiresAt);
    return { attemptId: attempt.id, url: session.url, amountPence: amount, reused: false };
  }

  logger.error({ tries }, 'checkout could not be started after retries');
  await db.update(checkoutAttempts).set({ status: 'failed' }).where(eq(checkoutAttempts.id, attempt.id));
  await recordAudit(db, {
    actor: SYSTEM,
    action: 'payment.checkout_failed',
    entityType: 'booking',
    entityId: opts.bookingId,
    metadata: { tries, keptHold: Boolean(opts.keepHoldOnFailure) },
  });
  if (opts.keepHoldOnFailure) throw new PayLinkUnavailableError(formatDateTimeLondon(expiresAt));
  await releaseHolds(db, opts.bookingId, now, 'Card payment unavailable', dayIds);
  throw new ConflictError(
    'Card payments aren’t available right now, so nothing has been booked. Please try again shortly.',
  );
}

/** Live holds on a booking: pending_payment days whose deadline hasn't passed. */
async function liveHolds(db: Db, bookingId: string, now: Date) {
  const rows = await db
    .select({ id: bookingDogs.id, customerId: bookingDogs.customerId, holdUntil: bookingDogs.offerExpiresAt })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.bookingId, bookingId),
        eq(bookingDogs.status, 'pending_payment'),
        gt(bookingDogs.offerExpiresAt, now),
      ),
    );
  if (!rows.length) return null;
  const until = rows.map((r) => r.holdUntil!).reduce((a, b) => (a < b ? a : b));
  return { customerId: rows[0]!.customerId, until, ids: rows.map((r) => r.id) };
}

async function approvedRequestFor(db: Db, bookingId: string) {
  const [r] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.subjectKey, `booking:${bookingId}`), eq(approvalRequests.status, 'approved')))
    .limit(1);
  return Boolean(r);
}

/**
 * Customer "Pay now" for a booking with places held for payment: reuses the open checkout or
 * creates one on demand (e.g. if it couldn't be created when the request was approved).
 */
export async function payForMyBooking(db: Db, actor: Actor, rawBookingId: string, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'bookings.self.manage', { ownerUserId: customer.userId });
  const bookingId = idOrNotFound(rawBookingId, 'Booking');
  const [b] = await db.select({ customerId: bookings.customerId }).from(bookings).where(eq(bookings.id, bookingId));
  if (!b || b.customerId !== customer.id) throw new NotFoundError('Booking');
  const hold = await liveHolds(db, bookingId, now);
  if (!hold) return (await alreadyPaidBooking(db, bookingId)) ?? payLinkEnded('expired');
  const r = await startBookingCheckout(
    db,
    {
      bookingId,
      bookingDogIds: hold.ids,
      customerId: customer.id,
      createdBy: me.userId,
      expiresAt: hold.until,
      tries: 2,
      keepHoldOnFailure: true,
    },
    now,
  );
  return r ? { url: r.url, reason: null, to: null } : payLinkEnded('expired');
}

/** Where a pay link sends the customer when there's no card page to open (shown as a notice on that page). */
function payLinkEnded(reason: 'expired' | 'preparing' | 'unavailable'): {
  url: null;
  reason: typeof reason;
  to: string;
} {
  return { url: null, reason, to: `/account/bookings?payment=${reason}` };
}

/** A pay link for something already paid: say so, and link to the receipt. */
function alreadyPaid(attempt: {
  purpose: 'booking' | 'invoice';
  invoiceId: string | null;
  resultInvoiceId: string | null;
}) {
  const to =
    attempt.purpose === 'invoice' && attempt.invoiceId
      ? `/account/invoices/${attempt.invoiceId}?payment=already-paid`
      : `/account/bookings?payment=already-paid${attempt.resultInvoiceId ? `&receipt=${attempt.resultInvoiceId}` : ''}`;
  return { url: null, reason: 'already-paid' as const, to };
}

/** The booking's places were paid by card (no places still held): the newest paid checkout for it. */
async function alreadyPaidBooking(db: Db, bookingId: string) {
  const [paid] = await db
    .select({
      purpose: checkoutAttempts.purpose,
      invoiceId: checkoutAttempts.invoiceId,
      resultInvoiceId: checkoutAttempts.resultInvoiceId,
    })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.bookingId, bookingId), eq(checkoutAttempts.status, 'paid')))
    .orderBy(desc(checkoutAttempts.completedAt))
    .limit(1);
  return paid ? alreadyPaid(paid) : null;
}

/** Owner: email the customer a pay link again, creating the checkout if it's missing. */
export async function resendPayLink(db: Db, actor: Actor, rawBookingId: string, now = new Date()) {
  assertAuthorized(actor, 'bookings.manage');
  const bookingId = idOrNotFound(rawBookingId, 'Booking');
  const hold = await liveHolds(db, bookingId, now);
  if (!hold) throw new ConflictError('Nothing on this booking is waiting for payment any more.');
  const r = await startBookingCheckout(
    db,
    {
      bookingId,
      bookingDogIds: hold.ids,
      customerId: hold.customerId,
      createdBy: actor.kind === 'user' ? actor.userId : null,
      expiresAt: hold.until,
      notifyByEmail: true,
      approvedRequest: await approvedRequestFor(db, bookingId),
      tries: 2,
      keepHoldOnFailure: true,
    },
    now,
  );
  await recordAudit(db, {
    actor,
    action: 'payment.link_resent',
    entityType: 'booking',
    entityId: bookingId,
    metadata: { reused: Boolean(r?.reused) },
  });
  return { sent: Boolean(r) };
}

/**
 * Owner: bookings with places held for payment but no working pay link (the provider couldn't
 * be reached). Shown on Requests and the day view with "Resend pay link".
 */
export async function bookingsMissingPayLink(db: Db, actor: Actor, opts: { date?: string } = {}, now = new Date()) {
  assertAuthorized(actor, 'bookings.manage');
  const rows = await db
    .select({
      bookingId: bookingDogs.bookingId,
      bookingDogId: bookingDogs.id,
      serviceDate: bookingDogs.serviceDate,
      dogName: dogs.name,
      customerName: users.name,
      holdUntil: bookingDogs.offerExpiresAt,
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .innerJoin(customers, eq(customers.id, bookingDogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(
      and(
        eq(bookingDogs.status, 'pending_payment'),
        gt(bookingDogs.offerExpiresAt, now),
        opts.date ? eq(bookingDogs.serviceDate, opts.date) : undefined,
        sql`not ${coveredDay(sql`c.status in ('open', 'creating') and c.expires_at > ${now}`)}`,
      ),
    )
    .orderBy(asc(bookingDogs.offerExpiresAt));
  const failed = rows.length
    ? await db
        .select({ bookingId: checkoutAttempts.bookingId, at: sql<Date>`max(${checkoutAttempts.createdAt})` })
        .from(checkoutAttempts)
        .where(
          and(
            eq(checkoutAttempts.status, 'failed'),
            inArray(checkoutAttempts.bookingId, [...new Set(rows.map((r) => r.bookingId))]),
          ),
        )
        .groupBy(checkoutAttempts.bookingId)
    : [];
  const failedAt = new Map(failed.map((f) => [f.bookingId, f.at]));
  const byBooking = new Map<
    string,
    {
      bookingId: string;
      customerName: string;
      days: string[];
      holdUntil: Date;
      failedAt: Date | null;
      bookingDogIds: string[];
    }
  >();
  for (const r of rows) {
    const e = byBooking.get(r.bookingId) ?? {
      bookingId: r.bookingId,
      customerName: r.customerName,
      days: [],
      holdUntil: r.holdUntil!,
      failedAt: failedAt.get(r.bookingId) ? new Date(failedAt.get(r.bookingId)!) : null,
      bookingDogIds: [],
    };
    e.days.push(`${r.dogName} ${r.serviceDate}`);
    e.bookingDogIds.push(r.bookingDogId);
    byBooking.set(r.bookingId, e);
  }
  return [...byBooking.values()];
}

/** The customer's held bookings that have no working pay link yet ("Pay now" creates one). */
export async function myHoldsWithoutPayLink(db: Db, actor: Actor, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'bookings.self.manage', { ownerUserId: customer.userId });
  const rows = await db
    .select({
      bookingId: bookingDogs.bookingId,
      dogName: dogs.name,
      holdUntil: bookingDogs.offerExpiresAt,
      totalPence: priceSnapshots.totalPence,
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .innerJoin(priceSnapshots, eq(priceSnapshots.bookingDogId, bookingDogs.id))
    .where(
      and(
        eq(bookingDogs.customerId, customer.id),
        eq(bookingDogs.status, 'pending_payment'),
        gt(bookingDogs.offerExpiresAt, now),
        sql`not ${coveredDay(sql`c.status = 'open' and c.expires_at > ${now}`)}`,
      ),
    );
  const out = new Map<
    string,
    { bookingId: string; days: number; dogs: Set<string>; amountPence: number; holdUntil: Date }
  >();
  for (const r of rows) {
    const e = out.get(r.bookingId) ?? {
      bookingId: r.bookingId,
      days: 0,
      dogs: new Set(),
      amountPence: 0,
      holdUntil: r.holdUntil!,
    };
    e.days++;
    e.dogs.add(r.dogName);
    e.amountPence += r.totalPence;
    if (r.holdUntil! < e.holdUntil) e.holdUntil = r.holdUntil!;
    out.set(r.bookingId, e);
  }
  return [...out.values()].map((e) => ({ ...e, dogs: [...e.dogs].join(' and ') }));
}

/** Scheduler: holds whose deadline passed with no open checkout (the pay link was never created). */
async function releaseOrphanHolds(db: Db, now: Date) {
  const due = await db
    .selectDistinct({ bookingId: bookingDogs.bookingId, customerId: bookingDogs.customerId })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.status, 'pending_payment'),
        lte(bookingDogs.offerExpiresAt, now),
        sql`not ${coveredDay(sql`c.status = 'open'`)}`,
      ),
    );
  let released = 0;
  for (const d of due) {
    const n = await db.transaction(async (tx) => {
      const r = await tx
        .update(bookingDogs)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: null,
          lateCancellation: false,
          internalNote: 'Not paid in time',
          version: sql`${bookingDogs.version} + 1`,
        })
        .where(
          and(
            eq(bookingDogs.bookingId, d.bookingId),
            eq(bookingDogs.status, 'pending_payment'),
            lte(bookingDogs.offerExpiresAt, now),
            sql`not ${coveredDay(sql`c.status = 'open'`)}`,
          ),
        )
        .returning({ id: bookingDogs.id });
      if (r.length)
        await recordAudit(tx, {
          actor: SYSTEM,
          action: 'payment.hold_released',
          entityType: 'booking',
          entityId: d.bookingId,
          metadata: { released: r.length, reason: 'no_checkout' },
        });
      return r.length;
    });
    if (n) {
      const who = await customerContact(db, d.customerId);
      await sendSafely(holdReleasedMessage(who.email, firstNameOf(who.name), 'your booking', appUrl('/account/book')));
    }
    released += n;
  }
  return released;
}

async function releaseHolds(q: Db | Tx, bookingId: string, now: Date, note: string, ids: string[] | null) {
  const released = await q
    .update(bookingDogs)
    .set({
      status: 'cancelled',
      cancelledAt: now,
      cancelledBy: null,
      lateCancellation: false,
      internalNote: note,
      version: sql`${bookingDogs.version} + 1`,
    })
    .where(
      and(
        eq(bookingDogs.bookingId, bookingId),
        eq(bookingDogs.status, 'pending_payment'),
        ids ? inArray(bookingDogs.id, ids.length ? ids : [NO_ID]) : undefined,
      ),
    )
    .returning({ id: bookingDogs.id });
  return released.length;
}

/**
 * Record a paid checkout. Idempotent: whichever of the return page, the webhook or the scheduler
 * gets here first does the work; later calls see status 'paid' and stop.
 */
export async function completeCheckout(db: Db, attemptId: string, now = new Date()) {
  const [attempt] = await db.select().from(checkoutAttempts).where(eq(checkoutAttempts.id, attemptId));
  if (!attempt || !attempt.providerSessionId) return { paid: false as const };
  if (attempt.status === 'paid') return { paid: true as const, already: true };
  const state = await getPaymentProvider().getCheckout(attempt.providerSessionId);
  if (!state.paid || !state.paymentId) return { paid: false as const, state: state.status };

  const result = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(checkoutAttempts).where(eq(checkoutAttempts.id, attemptId)).for('update');
    if (!locked || locked.status === 'paid') return null;
    if (locked.purpose === 'invoice')
      return completeInvoicePayment(tx, locked, state.paymentId!, state.amountPence, now);
    return completeBookingPayment(tx, locked, state.paymentId!, state.amountPence, now);
  });
  await submitPendingRefunds(db);
  if (result) {
    const who = await customerContact(db, attempt.customerId);
    await sendSafely(
      paymentReceivedMessage(
        who.email,
        firstNameOf(who.name),
        { amountText: pounds(state.amountPence), forText: result.forText, number: result.number },
        appUrl(result.invoiceId ? `/account/invoices/${result.invoiceId}` : '/account/invoices'),
      ),
    );
  }
  return { paid: true as const, already: !result };
}

async function completeInvoicePayment(
  tx: Tx,
  attempt: typeof checkoutAttempts.$inferSelect,
  paymentId: string,
  amountPence: number,
  now: Date,
) {
  const invoiceId = attempt.invoiceId!;
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for('update');
  const [pay] = await tx
    .insert(payments)
    .values({
      invoiceId,
      amountPence,
      method: 'stripe',
      providerPaymentId: paymentId,
      checkoutAttemptId: attempt.id,
      receivedOn: londonDate(now),
    })
    .onConflictDoNothing({ target: payments.providerPaymentId })
    .returning();
  await tx
    .update(checkoutAttempts)
    .set({ status: 'paid', completedAt: now })
    .where(eq(checkoutAttempts.id, attempt.id));
  if (!pay) return null;
  const { bal } = await settleTx(tx, invoiceId, now);
  // Paid twice (two tabs, or paid after a credit): send the extra back automatically (D58).
  if (bal.overpaidPence > 0)
    await queueCardRefunds(tx, {
      invoiceId,
      amountPence: bal.overpaidPence,
      creditNoteId: null,
      reason: 'Overpayment returned',
    });
  await recordAudit(tx, {
    actor: SYSTEM,
    action: 'payment.card_received',
    entityType: 'invoice',
    entityId: invoiceId,
    metadata: { amountPence, overpaidPence: bal.overpaidPence },
  });
  return { invoiceId, number: inv?.number ?? null, forText: `invoice ${inv?.number ?? ''}`.trim() };
}

/**
 * Confirm the held places, issue a paid invoice for them (D6) and record the payment. If a hold
 * had lapsed and the place has since gone, that day is credited and refunded automatically.
 */
async function completeBookingPayment(
  tx: Tx,
  attempt: typeof checkoutAttempts.$inferSelect,
  paymentId: string,
  amountPence: number,
  now: Date,
) {
  const days = await pendingDays(tx, attempt.bookingId!, await attemptDayIds(tx, attempt.id));
  const settings = await loadSettings(tx);
  const locked = await lockDays(
    tx,
    days.map((d) => d.serviceDate),
    settings,
    now,
  );
  const confirmed: typeof days = [];
  const lost: typeof days = [];
  for (const d of days) {
    const holdLive = d.holdUntil !== null && d.holdUntil > now;
    const day = locked.get(d.serviceDate)!;
    // A live hold is already counted in `used`; a lapsed one isn't, so check there's still room.
    const ok = holdLive || fits(d.session as Session, d.taxi, day.used, day.cap).ok;
    if (ok) {
      if (!holdLive) consume(day.used, d.session as Session, d.taxi);
      confirmed.push(d);
    } else lost.push(d);
  }
  if (confirmed.length)
    await tx
      .update(bookingDogs)
      .set({ status: 'confirmed', offerExpiresAt: null, version: sql`${bookingDogs.version} + 1` })
      .where(
        inArray(
          bookingDogs.id,
          confirmed.map((d) => d.id),
        ),
      );
  if (lost.length)
    await tx
      .update(bookingDogs)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        lateCancellation: false,
        internalNote: 'Full by the time payment arrived – refunded',
        version: sql`${bookingDogs.version} + 1`,
      })
      .where(
        inArray(
          bookingDogs.id,
          lost.map((d) => d.id),
        ),
      );

  const billed = [...confirmed, ...lost];
  const total = billed.reduce((a, d) => a + d.totalPence, 0);
  const [inv] = await tx
    .insert(invoices)
    .values({
      customerId: attempt.customerId,
      kind: 'booking',
      periodMonth: monthOf(billed[0]?.serviceDate ?? londonDate(now)),
      status: 'draft',
      totalPence: total,
    })
    .returning();
  const lineRows = billed.length
    ? await tx
        .insert(invoiceLines)
        .values(
          billed.map((d, i) => ({
            invoiceId: inv!.id,
            bookingDogId: d.id,
            position: i + 1,
            serviceDate: d.serviceDate,
            description: lineDescription(d.dogName, d.serviceDate, d.session, d.taxi),
            amountPence: d.totalPence,
          })),
        )
        .returning()
    : [];
  // Lines can only be added to a draft; then it's approved and issued in the same transaction.
  await tx
    .update(invoices)
    .set({ status: 'scheduled', scheduledFor: now, approvedAt: now })
    .where(eq(invoices.id, inv!.id));
  const issued = await issueTx(tx, inv!.id, now, { requireDetails: false });
  await tx.insert(payments).values({
    invoiceId: inv!.id,
    amountPence,
    method: 'stripe',
    providerPaymentId: paymentId,
    checkoutAttemptId: attempt.id,
    receivedOn: londonDate(now),
  });
  await settleTx(tx, inv!.id, now);
  if (lost.length) {
    const lostLines = lineRows.filter((l) => lost.some((d) => d.id === l.bookingDogId));
    await createCreditNoteTx(
      tx,
      SYSTEM,
      { id: inv!.id, status: 'paid' },
      {
        lines: lostLines.map((l) => ({ id: l.id, amountPence: l.amountPence })),
        amountPence: lostLines.reduce((a, l) => a + l.amountPence, 0),
        reason: 'Sorry – the place was taken before your payment arrived',
      },
      now,
    );
  }
  // The checkout total should match the held days; if not, refund any excess (never keep extra money).
  if (amountPence > total)
    await queueCardRefunds(tx, {
      invoiceId: inv!.id,
      amountPence: amountPence - total,
      creditNoteId: null,
      reason: 'Overpayment returned',
    });
  await tx
    .update(checkoutAttempts)
    .set({ status: 'paid', completedAt: now, resultInvoiceId: inv!.id })
    .where(eq(checkoutAttempts.id, attempt.id));
  await recordAudit(tx, {
    actor: SYSTEM,
    action: 'payment.booking_paid',
    entityType: 'checkout_attempt',
    entityId: attempt.id,
    metadata: { amountPence, confirmed: confirmed.length, refundedFull: lost.length, invoice: issued?.number ?? null },
  });
  return { invoiceId: inv!.id, number: issued?.number ?? null, forText: describeDays(billed) };
}

/**
 * End an unpaid checkout and free its places. Asks the provider first: if the customer actually
 * paid at the last moment, the payment is recorded instead.
 */
export async function releaseCheckout(
  db: Db,
  attemptId: string,
  opts: { reason: string; notify: boolean },
  now = new Date(),
) {
  const [attempt] = await db.select().from(checkoutAttempts).where(eq(checkoutAttempts.id, attemptId));
  if (!attempt || attempt.status !== 'open') return { released: 0 };
  const state = attempt.providerSessionId ? await getPaymentProvider().expireCheckout(attempt.providerSessionId) : null;
  if (state?.paid) {
    await completeCheckout(db, attemptId, now);
    return { released: 0, paid: true };
  }
  const released = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(checkoutAttempts).where(eq(checkoutAttempts.id, attemptId)).for('update');
    if (!locked || locked.status !== 'open') return 0;
    await tx
      .update(checkoutAttempts)
      .set({ status: 'expired', completedAt: now })
      .where(eq(checkoutAttempts.id, attemptId));
    const n = locked.bookingId
      ? await releaseHolds(tx, locked.bookingId, now, opts.reason, await attemptDayIds(tx, locked.id))
      : 0;
    await recordAudit(tx, {
      actor: SYSTEM,
      action: 'payment.checkout_released',
      entityType: 'checkout_attempt',
      entityId: attemptId,
      metadata: { released: n, purpose: locked.purpose },
    });
    return n;
  });
  if (released && opts.notify) {
    const who = await customerContact(db, attempt.customerId);
    await sendSafely(holdReleasedMessage(who.email, firstNameOf(who.name), 'your booking', appUrl('/account/book')));
  }
  return { released };
}

/**
 * After a credit note or manual payment lowers what's owed, close any open card checkout on the
 * invoice that would now take more than is due (review L2), so the customer isn't charged and then
 * refunded. Best effort: the credit or payment has already been saved, and a checkout that can't
 * be closed now still expires on schedule (any payment taken is refunded automatically, D58).
 */
export async function releaseOverchargingCheckouts(db: Db, invoiceId: string, now = new Date()) {
  const open = await db
    .select({ id: checkoutAttempts.id, amountPence: checkoutAttempts.amountPence })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.invoiceId, invoiceId), eq(checkoutAttempts.status, 'open')));
  if (!open.length) return 0;
  const due = (await balances(db, [invoiceId])).get(invoiceId)?.duePence ?? 0;
  let closed = 0;
  for (const a of open) {
    if (a.amountPence <= due) continue;
    try {
      const r = await releaseCheckout(db, a.id, { reason: 'Amount owed changed', notify: false }, now);
      if (!r.paid) closed++;
    } catch (err) {
      logger.warn(
        { err, checkoutAttemptId: a.id },
        'could not close an invoice checkout after the amount owed changed',
      );
    }
  }
  return closed;
}

/** Scheduler: free places whose payment time has run out (and pick up any late payments). */
export async function releaseExpiredCheckouts(db: Db, now = new Date()) {
  const due = await db
    .select({ id: checkoutAttempts.id, purpose: checkoutAttempts.purpose })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.status, 'open'), lte(checkoutAttempts.expiresAt, now)));
  let released = 0;
  let errors = 0;
  for (const a of due) {
    // One checkout the provider can't answer for mustn't stop the others being released (#10).
    try {
      released += (
        await releaseCheckout(db, a.id, { reason: 'Not paid in time', notify: a.purpose === 'booking' }, now)
      ).released;
    } catch (err) {
      errors++;
      logger.error({ attempt: a.id, err: err instanceof Error ? err.name : 'unknown' }, 'releasing checkout failed');
    }
  }
  // Holds with no open checkout covering them (the provider was down) lapse here too.
  released += await releaseOrphanHolds(db, now);
  return { checkouts: due.length, released, errors };
}

/**
 * Scheduler safety net for missed webhooks: pick up checkouts that were paid but never confirmed
 * (the customer closed the tab before returning).
 */
export async function reconcileOpenCheckouts(db: Db, now = new Date()) {
  const open = await db
    .select({ id: checkoutAttempts.id })
    .from(checkoutAttempts)
    .where(
      and(eq(checkoutAttempts.status, 'open'), lte(checkoutAttempts.createdAt, new Date(now.getTime() - 5 * 60_000))),
    )
    .orderBy(asc(checkoutAttempts.createdAt))
    .limit(50);
  let paid = 0;
  let errors = 0;
  for (const a of open) {
    try {
      if ((await completeCheckout(db, a.id, now)).paid) paid++;
    } catch (err) {
      errors++;
      logger.error({ attempt: a.id, err: err instanceof Error ? err.name : 'unknown' }, 'checking checkout failed');
    }
  }
  return { checked: open.length, paid, errors };
}

/**
 * Cancel one held (unpaid) day: release the open checkout(s) that include it, which frees the
 * days paid for together with it, then free the day itself if no checkout covered it (e.g. the
 * provider was down). Other checkouts on the same booking are left alone.
 */
export async function releaseBookingHold(
  db: Db,
  bookingId: string,
  bookingDogId: string,
  reason: string,
  now = new Date(),
) {
  const open = await db
    .selectDistinct({ id: checkoutAttempts.id })
    .from(checkoutAttempts)
    .leftJoin(checkoutAttemptDays, eq(checkoutAttemptDays.checkoutAttemptId, checkoutAttempts.id))
    .where(
      and(
        eq(checkoutAttempts.bookingId, bookingId),
        eq(checkoutAttempts.status, 'open'),
        // Attempts from before days were recorded have no rows: treat them as covering the booking.
        or(eq(checkoutAttemptDays.bookingDogId, bookingDogId), isNull(checkoutAttemptDays.bookingDogId)),
      ),
    );
  let released = 0;
  for (const a of open) released += (await releaseCheckout(db, a.id, { reason, notify: false }, now)).released;
  released += await releaseHolds(db, bookingId, now, reason, [bookingDogId]);
  return released;
}

/**
 * A paid ad hoc / extra / trial day cancelled free of charge (48 h+ ahead, or by the Owner without
 * a charge): credit its line and queue the card refund (D20, D58). Inside the caller's transaction;
 * call submitPendingRefunds after commit. Returns the amount credited (0 if it wasn't paid by booking).
 */
export async function refundBookingDayTx(tx: Tx, bookingDogId: string, reason: string, now: Date) {
  const [line] = await tx
    .select({
      id: invoiceLines.id,
      amountPence: invoiceLines.amountPence,
      invoiceId: invoiceLines.invoiceId,
      status: invoices.status,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .leftJoin(creditNoteLines, eq(creditNoteLines.invoiceLineId, invoiceLines.id))
    .where(
      and(
        eq(invoiceLines.bookingDogId, bookingDogId),
        eq(invoices.kind, 'booking'),
        inArray(invoices.status, ['issued', 'paid']),
        isNull(creditNoteLines.invoiceLineId),
      ),
    );
  if (!line || line.amountPence <= 0) return 0;
  await tx.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, line.invoiceId)).for('update');
  await createCreditNoteTx(
    tx,
    SYSTEM,
    { id: line.invoiceId, status: line.status },
    { lines: [{ id: line.id, amountPence: line.amountPence }], amountPence: line.amountPence, reason },
    now,
  );
  return line.amountPence;
}

// ---- Customer-facing -------------------------------------------------------------------

async function loadMyAttempt(db: Db, actor: Actor, rawId: string) {
  const id = idOrNotFound(rawId, 'Payment');
  const [attempt] = await db.select().from(checkoutAttempts).where(eq(checkoutAttempts.id, id));
  if (!attempt) throw new NotFoundError('Payment');
  if (hasPermission(actor, 'invoices.manage')) return attempt;
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  if (attempt.customerId !== customer.id) throw new NotFoundError('Payment');
  assertAuthorized(me, 'invoices.self.read', { ownerUserId: customer.userId });
  return attempt;
}

/** Where the customer lands after the checkout page (success or cancel). Confirms the payment if made. */
export async function returnFromCheckout(db: Db, actor: Actor, rawId: string, cancelled: boolean, now = new Date()) {
  const attempt = await loadMyAttempt(db, actor, rawId);
  const target =
    attempt.purpose === 'invoice' ? `/account/invoices/${attempt.invoiceId}` : ('/account/bookings' as string);
  if (cancelled) return `${target}?payment=cancelled`;
  const r = await completeCheckout(db, attempt.id, now);
  return `${target}?payment=${r.paid ? 'paid' : 'processing'}`;
}

/** "Pay now" link (from the bookings page or the Owner's payment email). */
export async function resumeCheckoutUrl(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const attempt = await loadMyAttempt(db, actor, rawId);
  if (attempt.status === 'paid') return alreadyPaid(attempt);
  if (attempt.status === 'open' && attempt.url && attempt.expiresAt > now)
    return { url: attempt.url, reason: null, to: null };
  // The link in the email still works if the checkout failed or was replaced: make (or reuse) one
  // for the places still held on that booking.
  if (attempt.purpose === 'booking' && attempt.bookingId && !hasPermission(actor, 'invoices.manage'))
    return payForMyBooking(db, actor, attempt.bookingId, now);
  return payLinkEnded('expired');
}

/** The customer's bookings still waiting for payment. */
export async function myOpenCheckouts(db: Db, actor: Actor, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'bookings.self.manage', { ownerUserId: customer.userId });
  const rows = await db
    .select()
    .from(checkoutAttempts)
    .where(
      and(
        eq(checkoutAttempts.customerId, customer.id),
        eq(checkoutAttempts.status, 'open'),
        eq(checkoutAttempts.purpose, 'booking'),
      ),
    )
    .orderBy(asc(checkoutAttempts.expiresAt));
  return rows.filter((r) => r.expiresAt > now);
}

/** Customer pays what's owed on an invoice by card (D59). Any older unpaid checkout is closed first. */
export async function startInvoiceCheckout(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const detail = await myInvoice(db, actor, rawId, now);
  const invoiceId = detail.inv.id;
  const older = await db
    .select({ id: checkoutAttempts.id })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.invoiceId, invoiceId), eq(checkoutAttempts.status, 'open')));
  for (const o of older) await releaseCheckout(db, o.id, { reason: 'Replaced', notify: false }, now);
  const bal = (await balances(db, [invoiceId])).get(invoiceId)!;
  if (bal.duePence <= 0) throw new ConflictError('There’s nothing left to pay on this invoice.');
  const who = await customerContact(db, detail.inv.customerId);
  const provider = getPaymentProvider();
  const description = `Luna’s K9 Club – invoice ${detail.inv.number}`;
  const expiresAt = holdUntil(now, OWNER_HOLD_MINUTES);
  const [attempt] = await db
    .insert(checkoutAttempts)
    .values({
      createdAt: now,
      purpose: 'invoice',
      customerId: detail.inv.customerId,
      invoiceId,
      amountPence: bal.duePence,
      description,
      provider: provider.name,
      expiresAt,
      createdBy: actor.kind === 'user' ? actor.userId : null,
    })
    .returning();
  try {
    const s = await provider.createCheckout({
      reference: attempt!.id,
      amountPence: bal.duePence,
      description,
      customerEmail: who.email,
      successUrl: appUrl(`/api/payments/return?attempt=${attempt!.id}`),
      cancelUrl: appUrl(`/api/payments/return?attempt=${attempt!.id}&cancelled=1`),
      expiresAt,
    });
    await db
      .update(checkoutAttempts)
      .set({ status: 'open', providerSessionId: s.id, url: s.url })
      .where(eq(checkoutAttempts.id, attempt!.id));
    await recordAudit(db, {
      actor,
      action: 'payment.checkout_started',
      entityType: 'checkout_attempt',
      entityId: attempt!.id,
      metadata: { purpose: 'invoice', amountPence: bal.duePence },
    });
    return { url: s.url };
  } catch {
    await db.update(checkoutAttempts).set({ status: 'failed' }).where(eq(checkoutAttempts.id, attempt!.id));
    throw new ConflictError('Card payments aren’t available right now. Please try again shortly.');
  }
}

// ---- Webhooks -------------------------------------------------------------------------

/**
 * Handle a Stripe webhook (non-negotiable 3): the signature is verified by the provider; each event
 * id is stored so a repeat delivery is ignored once processed; failures return an error so Stripe retries.
 */
export async function handleWebhook(db: Db, rawBody: string, signature: string | null, now = new Date()) {
  const provider = getPaymentProvider();
  const event = provider.parseWebhook(rawBody, signature);
  const [row] = await db
    .insert(webhookEvents)
    .values({ provider: provider.name, eventId: event.id, type: event.type })
    .onConflictDoUpdate({
      target: [webhookEvents.provider, webhookEvents.eventId],
      set: { attempts: sql`${webhookEvents.attempts} + 1` },
    })
    .returning();
  if (row?.processedAt) return { duplicate: true };
  try {
    if (event.type.startsWith('checkout.session.')) {
      const [attempt] = await db
        .select({ id: checkoutAttempts.id, purpose: checkoutAttempts.purpose })
        .from(checkoutAttempts)
        .where(eq(checkoutAttempts.providerSessionId, event.objectId));
      if (attempt) {
        if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded')
          await completeCheckout(db, attempt.id, now);
        else if (event.type === 'checkout.session.expired')
          await releaseCheckout(
            db,
            attempt.id,
            { reason: 'Not paid in time', notify: attempt.purpose === 'booking' },
            now,
          );
      }
    } else if (event.type.startsWith('refund.') && event.refundStatus) {
      await applyRefundUpdate(db, event.objectId, event.refundStatus, event.refundReference, event.refundAttempt);
    }
    await db
      .update(webhookEvents)
      .set({ processedAt: new Date(), lastError: null })
      .where(eq(webhookEvents.id, row!.id));
    return { duplicate: false };
  } catch (err) {
    await db
      .update(webhookEvents)
      .set({ lastError: err instanceof Error ? err.name : 'unknown' })
      .where(eq(webhookEvents.id, row!.id));
    throw err;
  }
}

/** Session start as an instant (for Owner holds). */
export function sessionStartInstant(settings: Parameters<typeof sessionTimes>[0], date: string, session: Session) {
  return londonInstant(date, sessionTimes(settings, session).start);
}
