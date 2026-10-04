import 'server-only';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import {
  bookingDogs,
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

async function pendingDays(q: Db | Tx, bookingId: string) {
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
    .where(and(eq(bookingDogs.bookingId, bookingId), eq(bookingDogs.status, 'pending_payment')))
    .orderBy(asc(bookingDogs.serviceDate), asc(dogs.name));
}

const describeDays = (days: { dogName: string }[]) => {
  const names = [...new Set(days.map((d) => d.dogName))].join(' and ');
  return `day care for ${names} (${days.length} ${days.length === 1 ? 'session' : 'sessions'})`;
};

/**
 * Open a card checkout for the places held on a booking. If the provider can't be reached the
 * holds are released straight away so nothing is left half-booked.
 */
export async function startBookingCheckout(
  db: Db,
  opts: { bookingId: string; customerId: string; createdBy: string | null; expiresAt: Date; notifyByEmail?: boolean },
  now = new Date(),
) {
  const days = await pendingDays(db, opts.bookingId);
  const amount = days.reduce((a, d) => a + d.totalPence, 0);
  if (!days.length || amount <= 0) return null;
  const who = await customerContact(db, opts.customerId);
  const provider = getPaymentProvider();
  const description = `Luna’s K9 Club – ${describeDays(days)}`;
  const [attempt] = await db
    .insert(checkoutAttempts)
    .values({
      purpose: 'booking',
      customerId: opts.customerId,
      bookingId: opts.bookingId,
      amountPence: amount,
      description,
      provider: provider.name,
      expiresAt: opts.expiresAt,
      createdBy: opts.createdBy,
    })
    .returning();
  try {
    const s = await provider.createCheckout({
      reference: attempt!.id,
      amountPence: amount,
      description,
      customerEmail: who.email,
      successUrl: appUrl(`/api/payments/return?attempt=${attempt!.id}`),
      cancelUrl: appUrl(`/api/payments/return?attempt=${attempt!.id}&cancelled=1`),
      expiresAt: opts.expiresAt,
    });
    await db
      .update(checkoutAttempts)
      .set({ status: 'open', providerSessionId: s.id, url: s.url })
      .where(eq(checkoutAttempts.id, attempt!.id));
    await recordAudit(db, {
      actor: SYSTEM,
      action: 'payment.checkout_started',
      entityType: 'checkout_attempt',
      entityId: attempt!.id,
      metadata: { purpose: 'booking', amountPence: amount },
    });
    if (opts.notifyByEmail)
      await sendSafely(
        paymentLinkMessage(
          who.email,
          firstNameOf(who.name),
          { amountText: pounds(amount), forText: describeDays(days), untilText: formatDateTimeLondon(opts.expiresAt) },
          appUrl(`/api/payments/pay/${attempt!.id}`),
        ),
      );
    return { attemptId: attempt!.id, url: s.url, amountPence: amount };
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.name : 'unknown' }, 'checkout could not be started');
    await db.update(checkoutAttempts).set({ status: 'failed' }).where(eq(checkoutAttempts.id, attempt!.id));
    await releaseHolds(db, opts.bookingId, now, 'Card payment unavailable');
    throw new ConflictError(
      'Card payments aren’t available right now, so nothing has been booked. Please try again shortly.',
    );
  }
}

async function releaseHolds(q: Db | Tx, bookingId: string, now: Date, note: string) {
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
    .where(and(eq(bookingDogs.bookingId, bookingId), eq(bookingDogs.status, 'pending_payment')))
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
  const days = await pendingDays(tx, attempt.bookingId!);
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
    const n = locked.bookingId ? await releaseHolds(tx, locked.bookingId, now, opts.reason) : 0;
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

/** Scheduler: free places whose payment time has run out (and pick up any late payments). */
export async function releaseExpiredCheckouts(db: Db, now = new Date()) {
  const due = await db
    .select({ id: checkoutAttempts.id, purpose: checkoutAttempts.purpose })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.status, 'open'), lte(checkoutAttempts.expiresAt, now)));
  let released = 0;
  for (const a of due)
    released += (await releaseCheckout(db, a.id, { reason: 'Not paid in time', notify: a.purpose === 'booking' }, now))
      .released;
  return { checkouts: due.length, released };
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
    .limit(50);
  let paid = 0;
  for (const a of open) if ((await completeCheckout(db, a.id, now)).paid) paid++;
  return { checked: open.length, paid };
}

/** The customer's open booking checkout for this booking (if they cancel or abandon, it's released). */
export async function releaseBookingHold(db: Db, bookingId: string, reason: string, now = new Date()) {
  const open = await db
    .select({ id: checkoutAttempts.id })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.bookingId, bookingId), eq(checkoutAttempts.status, 'open')));
  let released = 0;
  for (const a of open) released += (await releaseCheckout(db, a.id, { reason, notify: false }, now)).released;
  // Holds with no open checkout (e.g. the provider was down) are freed directly.
  released += await releaseHolds(db, bookingId, now, reason);
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
  if (attempt.status === 'paid') return { url: null, reason: 'paid' as const };
  if (attempt.status !== 'open' || !attempt.url || attempt.expiresAt <= now)
    return { url: null, reason: 'expired' as const };
  return { url: attempt.url, reason: null };
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
      await applyRefundUpdate(db, event.objectId, event.refundStatus);
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
