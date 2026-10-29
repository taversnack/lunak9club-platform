import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { setPaymentProvider } from '@/infra/payments';
import { SimulatedPaymentProvider } from '@/infra/payments/simulated';
import type { WebhookEvent } from '@/infra/payments/types';
import {
  auditEvents,
  bookingDogs,
  cardRefunds,
  checkoutAttemptDays,
  checkoutAttempts,
  creditNotes,
  customers,
  invoiceLines,
  invoices,
  payments,
  webhookEvents,
} from '@/infra/db/schema';
import { cancelMyBooking, createMyBookings } from '@/server/services/bookings';
import { giveWaitlistPlace, ownerCreateBooking, setDayCapacity } from '@/server/services/owner-bookings';
import { issueTx, markCreditRefunded, myInvoice, ownerInvoice } from '@/server/services/billing';
import {
  completeCheckout,
  handleWebhook,
  OWNER_HOLD_MINUTES,
  payForMyBooking,
  releaseExpiredCheckouts,
  resumeCheckoutUrl,
  startInvoiceCheckout,
} from '@/server/services/payments';
import { ownerCardRefunds, retryCardRefund, submitPendingRefunds } from '@/server/services/card-refunds';
import { ConflictError, NotFoundError } from '@/server/errors';
import { AuthorizationError } from '@/server/policy/authorize';

import { londonDate } from '@/domain/time';
import { weekdayPicker } from '../support/dates';
import { requestAndApprove } from '../support/requests';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer } from '../support/onboard';

/** Simulated Stripe that also accepts "signed" test webhooks (signature must be "valid"). */
class TestProvider extends SimulatedPaymentProvider {
  /** Make refunds go through but lose the answer, like a timeout after Stripe created them. */
  loseRefundAnswers = false;
  /** Refunds are accepted but not settled yet (Stripe's 'pending'); a webhook settles them later. */
  refundsPending = false;
  /** Make refunds fail the way an invalid Stripe key does. */
  badKey = false;
  /** Make each refund call slow, so concurrent runs overlap. */
  delayMs = 0;
  refundCalls = 0;
  override async refund(paymentId: string, amountPence: number, key: string, reference: string, attempt?: number) {
    this.refundCalls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.badKey)
      return {
        id: '',
        status: 'failed' as const,
        failureReason: 'StripeAuthenticationError: Invalid API Key provided',
        needsOwner: true,
      };
    const res = await super.refund(paymentId, amountPence, key, reference, attempt);
    if (this.loseRefundAnswers)
      return { id: '', status: 'pending' as const, failureReason: 'StripeConnectionError: timed out' };
    return this.refundsPending && res.status === 'succeeded' ? { ...res, status: 'pending' as const } : res;
  }
  override parseWebhook(raw: string, signature: string | null): WebhookEvent {
    if (signature !== 'valid') throw new Error('No signatures found matching the expected signature');
    return JSON.parse(raw) as WebhookEvent;
  }
}

const db = () => getDb();
const mail = new MemoryEmailProvider();
const stripe = new TestProvider('http://localhost:3000');
const today = londonDate(new Date());
/** Distinct open weekdays well away from other test files' dates. */
const weekdayAhead = weekdayPicker();

let owner: TestUser;
let pia: TestUser;
let quinn: TestUser;
let piaDog: string;
let quinnDog: string;

async function attemptsFor(customerUserId: string) {
  return db()
    .select({ a: checkoutAttempts })
    .from(checkoutAttempts)
    .innerJoin(customers, eq(customers.id, checkoutAttempts.customerId))
    .where(eq(customers.userId, customerUserId))
    .orderBy(sql`${checkoutAttempts.createdAt} desc`)
    .then((r) => r.map((x) => x.a));
}

async function payLatest(userId: string, now = new Date()) {
  const [a] = await attemptsFor(userId);
  stripe.pay(a!.providerSessionId!);
  await completeCheckout(db(), a!.id, now);
  return a!;
}

beforeAll(async () => {
  setEmailProvider(mail);
  setPaymentProvider(stripe);
  owner = await makeUser(db(), 'owner', 'Oscar Owner');
  pia = await makeUser(db(), 'customer', 'Pia Payer');
  quinn = await makeUser(db(), 'customer', 'Quinn Queue');
  await readyCustomer(db(), pia);
  await readyCustomer(db(), quinn);
  piaDog = await approvedDog(db(), owner, pia, 'Nutmeg');
  quinnDog = await approvedDog(db(), owner, quinn, 'Juniper');
});
afterAll(async () => {
  setEmailProvider(undefined);
  setPaymentProvider(undefined);
  await closeDb();
});

describe('pay at booking (D6)', () => {
  it('holds the place, confirms on payment and issues a paid invoice with a receipt', async () => {
    const date = weekdayAhead(40);
    const r = await requestAndApprove(
      db(),
      pia,
      { dogIds: [piaDog], dates: [date], session: 'full', taxi: false },
      owner,
    );
    expect(r.checkoutUrl).toMatch(/\/dev\/checkout\/sim_cs_/);
    const [held] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, piaDog), eq(bookingDogs.serviceDate, date)));
    expect(held!.status).toBe('pending_payment');
    expect(held!.offerExpiresAt!.getTime() - Date.now()).toBeGreaterThan(30 * 60_000);

    mail.sent.length = 0;
    const a = await payLatest(pia.userId);
    const again = await completeCheckout(db(), a.id); // webhook arriving after the return page
    expect(again).toMatchObject({ paid: true, already: true });

    const [done] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, held!.id));
    expect(done!.status).toBe('confirmed');
    const [attempt] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, a.id));
    expect(attempt!.status).toBe('paid');
    const inv = await myInvoice(db(), pia, attempt!.resultInvoiceId!);
    expect(inv.inv).toMatchObject({ kind: 'booking', status: 'paid' });
    expect(inv.inv.number).toMatch(/^LK9DOUGIE-\d{2,}$/);
    expect(inv.lines).toHaveLength(1);
    expect(inv.payments).toHaveLength(1);
    expect(inv.payments[0]).toMatchObject({ method: 'stripe', amountPence: 5000 });
    expect(mail.sent.find((m) => m.template === 'payment.received')?.to).toBe(pia.email);
  });

  it('a held place counts towards capacity', async () => {
    const date = weekdayAhead(41);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 1, taxiCapacity: 20 });
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false }, owner);
    const q = await requestAndApprove(
      db(),
      quinn,
      {
        dogIds: [quinnDog],
        dates: [date],
        session: 'full',
        taxi: false,
        ifFull: 'skip',
      },
      owner,
    );
    expect(q.outcomes[0]!.outcome).toBe('skipped');
  });

  it('releases unpaid places when the time runs out, and tells the customer', async () => {
    const [open] = await attemptsFor(pia.userId);
    expect(open!.status).toBe('open');
    mail.sent.length = 0;
    const later = new Date(open!.expiresAt.getTime() + 60_000);
    const r = await releaseExpiredCheckouts(db(), later);
    expect(r.released).toBeGreaterThanOrEqual(1);
    const rows = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, open!.bookingId!));
    expect(rows.every((x) => x.status === 'cancelled')).toBe(true);
    expect(mail.sent.some((m) => m.template === 'payment.hold-released' && m.to === pia.email)).toBe(true);
    expect((await resumeCheckoutUrl(db(), pia, open!.id)).url).toBeNull();
  });

  it('if the hold lapsed and the place went before payment arrived, it refunds automatically', async () => {
    const date = weekdayAhead(42);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 1, taxiCapacity: 20 });
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false }, owner);
    const [a] = await attemptsFor(pia.userId);
    // Quinn takes the place once Pia's hold has lapsed (simulated by a confirmed row).
    // Relative to the app's clock (Date, which TEST_NOW fakes), not Postgres now(): the app compares
    // against its own clock, so a DB-clock value is "not lapsed yet" when the pin is in the past.
    await db()
      .update(bookingDogs)
      .set({ offerExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(bookingDogs.bookingId, a!.bookingId!));
    await requestAndApprove(db(), quinn, { dogIds: [quinnDog], dates: [date], session: 'full', taxi: false }, owner);
    await payLatest(quinn.userId);
    // Pia's payment arrives late.
    stripe.pay(a!.providerSessionId!);
    await completeCheckout(db(), a!.id);
    const [row] = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a!.bookingId!));
    expect(row!.status).toBe('cancelled');
    const [paid] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, a!.id));
    const inv = await ownerInvoice(db(), owner, paid!.resultInvoiceId!);
    expect(inv.bal.creditedPence).toBe(5000);
    expect(inv.creditNotes[0]!.refundState).toBe('refunded');
    expect(stripe.refunds.some((x) => x.amountPence === 5000)).toBe(true);
  });

  it('cancelling an unpaid booking just releases it', async () => {
    const date = weekdayAhead(43);
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates: [date], session: 'am', taxi: false }, owner);
    const [held] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, piaDog), eq(bookingDogs.serviceDate, date)));
    expect(await cancelMyBooking(db(), pia, held!.id)).toEqual({ late: false, refundedPence: 0 });
    const [after] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, held!.id));
    expect(after!.status).toBe('cancelled');
    const [a] = await attemptsFor(pia.userId);
    expect(a!.status).toBe('expired');
  });
});

describe('two offers from one request (same bookingId)', () => {
  it('each checkout pays for, confirms and releases only its own day', async () => {
    const d1 = weekdayAhead(50);
    const d2 = weekdayAhead(51);
    for (const date of [d1, d2]) await setDayCapacity(db(), owner, { date, sessionCapacity: 0, taxiCapacity: 20 });
    const w = await createMyBookings(db(), quinn, {
      dogIds: [quinnDog],
      dates: [d1, d2],
      session: 'full',
      taxi: false,
      ifFull: 'waitlist',
    });
    expect(w.outcomes.map((o) => o.outcome)).toEqual(['waitlisted', 'waitlisted']);
    for (const date of [d1, d2]) await setDayCapacity(db(), owner, { date, sessionCapacity: 20, taxiCapacity: 20 });
    const row = async (date: string) =>
      (
        await db()
          .select()
          .from(bookingDogs)
          .where(and(eq(bookingDogs.dogId, quinnDog), eq(bookingDogs.serviceDate, date)))
      )[0]!;
    const [w1, w2] = [await row(d1), await row(d2)];
    expect(w1.bookingId).toBe(w2.bookingId);
    // The request found both days full and waitlisted them; the Owner gives each a place
    // separately: two open checkouts on one bookingId, one day each.
    await giveWaitlistPlace(db(), owner, w1.id, { version: w1.version });
    await giveWaitlistPlace(db(), owner, w2.id, { version: w2.version });
    // Find each day's checkout by the day it pays for, not by creation order (two checkouts made
    // back to back can share a timestamp).
    const paysFor = new Map(
      (await db().select().from(checkoutAttemptDays)).map((r) => [r.checkoutAttemptId, r.bookingDogId]),
    );
    const attemptFor = async (bookingDogId: string) =>
      (await attemptsFor(quinn.userId)).find((a) => paysFor.get(a.id) === bookingDogId);
    const [first, second] = [await attemptFor(w1.id), await attemptFor(w2.id)];
    expect(first!.amountPence).toBe(5000);
    expect(second!.amountPence).toBe(5000);

    // Paying the first confirms only day 1 and bills only day 1.
    stripe.pay(first!.providerSessionId!);
    await completeCheckout(db(), first!.id);
    expect((await row(d1)).status).toBe('confirmed');
    expect((await row(d2)).status).toBe('pending_payment');
    const [paid] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, first!.id));
    const lines = await db().select().from(invoiceLines).where(eq(invoiceLines.invoiceId, paid!.resultInvoiceId!));
    expect(lines.map((l) => l.serviceDate)).toEqual([d1]);

    // Cancelling the unpaid day 2 releases only its own checkout; the paid day is untouched.
    await cancelMyBooking(db(), quinn, w2.id);
    expect((await row(d2)).status).toBe('cancelled');
    expect((await row(d1)).status).toBe('confirmed');
    const [rel] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, second!.id));
    expect(rel!.status).toBe('expired');
  });

  it('an expired checkout releases only its own day, not a newer hold on the same booking', async () => {
    const d1 = weekdayAhead(36);
    const d2 = weekdayAhead(38);
    for (const date of [d1, d2]) await setDayCapacity(db(), owner, { date, sessionCapacity: 0, taxiCapacity: 20 });
    await createMyBookings(db(), quinn, {
      dogIds: [quinnDog],
      dates: [d1, d2],
      session: 'full',
      taxi: false,
      ifFull: 'waitlist',
    });
    for (const date of [d1, d2]) await setDayCapacity(db(), owner, { date, sessionCapacity: 20, taxiCapacity: 20 });
    const row = async (date: string) =>
      (
        await db()
          .select()
          .from(bookingDogs)
          .where(and(eq(bookingDogs.dogId, quinnDog), eq(bookingDogs.serviceDate, date)))
      )[0]!;
    const [w1, w2] = [await row(d1), await row(d2)];
    const t0 = new Date();
    await giveWaitlistPlace(db(), owner, w1.id, { version: w1.version }, t0);
    await giveWaitlistPlace(db(), owner, w2.id, { version: w2.version }, new Date(t0.getTime() + 60 * 60_000));
    // Just past the first hold (Owner holds last OWNER_HOLD_MINUTES): the second still has ~an hour.
    await releaseExpiredCheckouts(db(), new Date(t0.getTime() + (OWNER_HOLD_MINUTES + 1) * 60_000));
    expect((await row(d1)).status).toBe('cancelled');
    expect((await row(d2)).status).toBe('pending_payment');
  });
});

describe('automatic refunds (D20, D58)', () => {
  it('a paid day cancelled 48 h+ ahead goes back to the card, with a credit note', async () => {
    const date = weekdayAhead(44);
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false }, owner);
    const a = await payLatest(pia.userId);
    const [bd] = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a.bookingId!));
    const before = stripe.refunds.length;
    mail.sent.length = 0;
    expect(await cancelMyBooking(db(), pia, bd!.id)).toEqual({ late: false, refundedPence: 5000 });
    expect(stripe.refunds.length).toBe(before + 1);
    const [paidAttempt] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, a.id));
    const inv = await myInvoice(db(), pia, paidAttempt!.resultInvoiceId!);
    expect(inv.creditNotes).toHaveLength(1);
    expect(inv.creditNotes[0]).toMatchObject({ refundDuePence: 5000, refundState: 'refunded' });
    const refunds = await db().select().from(cardRefunds).where(eq(cardRefunds.creditNoteId, inv.creditNotes[0]!.id));
    expect(refunds.map((r) => r.status)).toEqual(['succeeded']);
  });

  it('a refund the provider rejects can be retried by the Owner', async () => {
    const date = weekdayAhead(45);
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false }, owner);
    const a = await payLatest(pia.userId);
    const [bd] = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a.bookingId!));
    stripe.failRefunds = true;
    await cancelMyBooking(db(), pia, bd!.id);
    stripe.failRefunds = false;
    const [failed] = await db().select().from(cardRefunds).where(eq(cardRefunds.status, 'failed'));
    expect(failed).toBeDefined();
    await expect(retryCardRefund(db(), pia, failed!.id)).rejects.toBeInstanceOf(AuthorizationError);
    await retryCardRefund(db(), owner, failed!.id);
    const [ok] = await db().select().from(cardRefunds).where(eq(cardRefunds.id, failed!.id));
    expect(ok!.status).toBe('succeeded');
    const [cn] = await db().select().from(creditNotes).where(eq(creditNotes.id, ok!.creditNoteId!));
    expect(cn!.refundState).toBe('refunded');
    await expect(retryCardRefund(db(), owner, failed!.id)).rejects.toBeInstanceOf(ConflictError);
  });

  /** Two paid days, £60 by card and £40 by bank transfer; returns the card payment and both day rows. */
  async function splitPaidTwoDays() {
    const dates = [weekdayAhead(60), weekdayAhead(60)];
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates, session: 'full', taxi: false }, owner);
    const a = await payLatest(pia.userId);
    const [card] = await db().select().from(payments).where(eq(payments.checkoutAttemptId, a.id));
    expect(card!.amountPence).toBe(10000);
    // Payments are append-only; reshape this one in the test only, as if £60 had been taken by card.
    await db().transaction(async (tx) => {
      await tx.execute(sql`alter table payments disable trigger payments_append_only`);
      await tx.update(payments).set({ amountPence: 6000 }).where(eq(payments.id, card!.id));
      await tx.execute(sql`alter table payments enable trigger payments_append_only`);
    });
    await db().insert(payments).values({
      invoiceId: card!.invoiceId,
      amountPence: 4000,
      method: 'manual',
      receivedOn: today,
      reason: 'part paid by bank transfer',
    });
    const days = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a.bookingId!));
    expect(days).toHaveLength(2);
    const refunds = () => db().select().from(cardRefunds).where(eq(cardRefunds.paymentId, card!.id));
    const sent = async () =>
      (await refunds()).filter((r) => r.status === 'succeeded').reduce((n, r) => n + r.amountPence, 0);
    return { card: card!, days, refunds, sent };
  }

  /** Test-only: rewrite a refund's amount, past the trigger that keeps card refunds honest. */
  async function legacyAmount(id: string, amountPence: number) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`alter table card_refunds disable trigger card_refunds_lock_trg`);
      await tx.update(cardRefunds).set({ amountPence }).where(eq(cardRefunds.id, id));
      await tx.execute(sql`alter table card_refunds enable trigger card_refunds_lock_trg`);
    });
  }

  it('a cancellation after a failed refund only queues what the card has left (the failed one is still owed)', async () => {
    const { days, refunds, sent } = await splitPaidTwoDays();
    stripe.failRefunds = true;
    await cancelMyBooking(db(), pia, days[0]!.id);
    stripe.failRefunds = false;
    expect((await refunds()).map((r) => [r.status, r.amountPence])).toEqual([['failed', 5000]]);
    await cancelMyBooking(db(), pia, days[1]!.id);
    const after = await refunds();
    // £50 is still retryable, so only £10 of the card's £60 is free: the other £40 is for the Owner.
    expect(after.filter((r) => r.status !== 'failed').map((r) => r.amountPence)).toEqual([1000]);
    expect(after.reduce((n, r) => n + r.amountPence, 0)).toBe(6000);
    // Retrying the failed one now fits exactly; nothing more than the card paid ever goes back.
    const failed = after.find((r) => r.status === 'failed')!;
    await retryCardRefund(db(), owner, failed.id);
    expect(await sent()).toBe(6000);
    expect(await retryCardRefund(db(), owner, failed.id).catch((e) => e)).toBeInstanceOf(ConflictError);
  });

  it('a retry is refused when it would push the card past what it paid, or the credit was settled another way', async () => {
    const { days, refunds, sent } = await splitPaidTwoDays();
    stripe.failRefunds = true;
    await cancelMyBooking(db(), pia, days[0]!.id);
    stripe.failRefunds = false;
    await cancelMyBooking(db(), pia, days[1]!.id);
    const failed = (await refunds()).find((r) => r.status === 'failed')!;
    const later = (await refunds()).find((r) => r.status !== 'failed')!;
    // A refund queued before this fix, when failed ones weren't counted, could take the whole card.
    await legacyAmount(later.id, 2000);
    const calls = stripe.refundCalls;
    await expect(retryCardRefund(db(), owner, failed.id)).rejects.toThrow(/more than this card paid/);
    expect(stripe.refundCalls).toBe(calls);
    expect((await db().select().from(cardRefunds).where(eq(cardRefunds.id, failed.id)))[0]!.status).toBe('failed');
    await legacyAmount(later.id, 1000);

    // The Owner returned that £50 by bank transfer instead: the failed refund is abandoned.
    await markCreditRefunded(db(), owner, failed.creditNoteId!, { reason: 'paid back by bank transfer' });
    await expect(retryCardRefund(db(), owner, failed.id)).rejects.toThrow(/refunded another way/);
    expect(stripe.refundCalls).toBe(calls);
    expect((await ownerCardRefunds(db(), owner)).failed.map((x) => x.r.id)).not.toContain(failed.id);
    expect(await sent()).toBe(1000);
  });

  it('partial refunds day by day still go back to the card in full', async () => {
    const dates = [weekdayAhead(62), weekdayAhead(62)];
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates, session: 'full', taxi: false }, owner);
    const a = await payLatest(pia.userId);
    const days = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a.bookingId!));
    expect(await cancelMyBooking(db(), pia, days[0]!.id)).toEqual({ late: false, refundedPence: 5000 });
    expect(await cancelMyBooking(db(), pia, days[1]!.id)).toEqual({ late: false, refundedPence: 5000 });
    const [pay] = await db().select().from(payments).where(eq(payments.checkoutAttemptId, a.id));
    const rs = await db().select().from(cardRefunds).where(eq(cardRefunds.paymentId, pay!.id));
    expect(rs.map((r) => [r.status, r.amountPence])).toEqual([
      ['succeeded', 5000],
      ['succeeded', 5000],
    ]);
  });

  it('concurrent ticks claim an interrupted refund once; a webhook settling it clears the old reason, is audited and emails the customer', async () => {
    const date = weekdayAhead(46);
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false }, owner);
    const a = await payLatest(pia.userId);
    const [bd] = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a.bookingId!));
    stripe.loseRefundAnswers = true;
    await cancelMyBooking(db(), pia, bd!.id);
    const [pay] = await db().select().from(payments).where(eq(payments.checkoutAttemptId, a.id));
    const [r] = await db().select().from(cardRefunds).where(eq(cardRefunds.paymentId, pay!.id));
    expect(r).toMatchObject({
      status: 'submitted',
      providerRefundId: null,
      failureReason: expect.stringMatching(/timed out/),
    });
    const audits = async () =>
      (await db().select().from(auditEvents).where(eq(auditEvents.entityId, r!.id))).map((e) => e.action).sort();
    const before = await audits();

    // Interrupted long enough ago for the safety net; three ticks arrive at once.
    // App clock, not Postgres now() (see the lapsed-hold test above).
    await db()
      .update(cardRefunds)
      .set({ updatedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(cardRefunds.id, r!.id));
    stripe.delayMs = 200;
    const calls = stripe.refundCalls;
    await Promise.all([submitPendingRefunds(db()), submitPendingRefunds(db()), submitPendingRefunds(db())]);
    stripe.delayMs = 0;
    stripe.loseRefundAnswers = false;
    expect(stripe.refundCalls - calls).toBe(1);
    expect(await audits()).toEqual([...before, 'refund.card_submitted'].sort());

    // Stripe's webhook settles it.
    mail.sent.length = 0;
    const sent = stripe.refunds.at(-1)!;
    const body = (n: number) =>
      JSON.stringify({
        id: `evt_h${n}_${r!.id}`,
        type: 'refund.updated',
        objectId: sent.id,
        refundStatus: 'succeeded',
        refundReference: r!.id,
      });
    await handleWebhook(db(), body(1), 'valid');
    await handleWebhook(db(), body(2), 'valid'); // a second event with the same news
    const [settled] = await db().select().from(cardRefunds).where(eq(cardRefunds.id, r!.id));
    expect(settled).toMatchObject({ status: 'succeeded', failureReason: null });
    const settledBy = await db()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, r!.id), eq(auditEvents.action, 'refund.card_succeeded')));
    expect(settledBy).toHaveLength(1);
    expect(settledBy[0]!.metadata).toMatchObject({ via: 'webhook' });
    const toPia = mail.sent.filter((m) => m.to === pia.email);
    expect(toPia.map((m) => m.subject)).toEqual([expect.stringMatching(/refund of £50\.00/)]);
  });

  it('an invalid Stripe key fails the refund for the Owner to see, and emails the Owner once', async () => {
    const date = weekdayAhead(46);
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false }, owner);
    const a = await payLatest(pia.userId);
    const [bd] = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a.bookingId!));
    await db().execute(sql`delete from notification_log where kind = 'card-refunds-failed'`);
    mail.sent.length = 0;
    stripe.badKey = true;
    await cancelMyBooking(db(), pia, bd!.id);
    const [pay] = await db().select().from(payments).where(eq(payments.checkoutAttemptId, a.id));
    const [r] = await db().select().from(cardRefunds).where(eq(cardRefunds.paymentId, pay!.id));
    // Not stuck in 'submitted': it's failed, with the reason, in the Owner's list to try again.
    expect(r).toMatchObject({ status: 'failed', failureReason: expect.stringMatching(/Invalid API Key/) });
    expect((await ownerCardRefunds(db(), owner)).failed.map((x) => x.r.id)).toContain(r!.id);
    const toOwner = mail.sent.filter((m) => m.to === owner.email && /need your attention/.test(m.subject));
    expect(toOwner).toHaveLength(1);
    expect(toOwner[0]!.text).toMatch(/Stripe refused our API key/);
    expect(toOwner[0]!.text).toContain('/admin/refunds');
    // Trying again with the key still wrong fails again, but doesn't email again the same day.
    await retryCardRefund(db(), owner, r!.id);
    expect(mail.sent.filter((m) => m.to === owner.email && /need your attention/.test(m.subject))).toHaveLength(1);
    // Once the key is fixed, Try again sends it.
    stripe.badKey = false;
    await retryCardRefund(db(), owner, r!.id);
    const [ok] = await db().select().from(cardRefunds).where(eq(cardRefunds.id, r!.id));
    expect(ok!.status).toBe('succeeded');
  });

  it('a refund whose answer was lost stays pending, and the webhook settles it by our id without a second refund', async () => {
    const date = weekdayAhead(47);
    await requestAndApprove(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false }, owner);
    const a = await payLatest(pia.userId);
    const [bd] = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, a.bookingId!));
    stripe.loseRefundAnswers = true;
    await cancelMyBooking(db(), pia, bd!.id);
    stripe.loseRefundAnswers = false;
    const sent = stripe.refunds.at(-1)!;
    const [pay] = await db().select().from(payments).where(eq(payments.checkoutAttemptId, a.id));
    const [r] = await db().select().from(cardRefunds).where(eq(cardRefunds.paymentId, pay!.id));
    expect(r).toMatchObject({ status: 'submitted', providerRefundId: null });
    expect((await ownerCardRefunds(db(), owner)).failed.map((x) => x.r.id)).not.toContain(r!.id);

    const body = JSON.stringify({
      id: `evt_refund_${r!.id}`,
      type: 'refund.updated',
      objectId: sent.id,
      refundStatus: 'succeeded',
      refundReference: r!.id,
    });
    await handleWebhook(db(), body, 'valid');
    const [settled] = await db().select().from(cardRefunds).where(eq(cardRefunds.id, r!.id));
    expect(settled).toMatchObject({ status: 'succeeded', providerRefundId: sent.id });
    const [cn] = await db().select().from(creditNotes).where(eq(creditNotes.id, settled!.creditNoteId!));
    expect(cn!.refundState).toBe('refunded');
    // The safety net has nothing left to resend.
    const count = stripe.refunds.length;
    await submitPendingRefunds(db());
    expect(stripe.refunds.length).toBe(count);
  });
});

describe('Owner bookings are paid by link (D59)', () => {
  it('holds the place and emails a payment link only the customer can use', async () => {
    const date = weekdayAhead(46);
    mail.sent.length = 0;
    const id = await ownerCreateBooking(db(), owner, { dogId: quinnDog, date, session: 'full' });
    const [bd] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, id));
    expect(bd!.status).toBe('pending_payment');
    expect(bd!.offerExpiresAt!.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    const email = mail.sent.find((m) => m.template === 'payment.link');
    expect(email?.to).toBe(quinn.email);
    const attemptId = email!.text.match(/\/api\/payments\/pay\/([0-9a-f-]{36})/)![1]!;
    expect((await resumeCheckoutUrl(db(), quinn, attemptId)).url).toMatch(/\/dev\/checkout\//);
    await expect(resumeCheckoutUrl(db(), pia, attemptId)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('paying an invoice by card (D59)', () => {
  let invoiceId: string;
  beforeAll(async () => {
    // A sent membership-style invoice for Pia (built directly: billing has its own tests).
    const [cust] = (await db().execute<{ id: string }>(sql`select id from customers where user_id = ${pia.userId}`))
      .rows;
    const [inv] = await db()
      .insert(invoices)
      .values({ customerId: cust!.id, periodMonth: today.slice(0, 7), status: 'draft', totalPence: 9600 })
      .returning();
    await db()
      .insert(invoiceLines)
      .values([
        { invoiceId: inv!.id, position: 1, description: 'Nutmeg – Full day', amountPence: 4800 },
        { invoiceId: inv!.id, position: 2, description: 'Nutmeg – Full day', amountPence: 4800 },
      ]);
    await db().update(invoices).set({ status: 'scheduled', scheduledFor: new Date() }).where(eq(invoices.id, inv!.id));
    await db().transaction((tx) => issueTx(tx, inv!.id, new Date(), { requireDetails: false }));
    invoiceId = inv!.id;
  });

  it('only the invoice’s customer can start a payment, and paying settles it', async () => {
    await expect(startInvoiceCheckout(db(), quinn, invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    const first = await startInvoiceCheckout(db(), pia, invoiceId);
    const second = await startInvoiceCheckout(db(), pia, invoiceId); // opening it twice closes the first
    expect(first.url).not.toBe(second.url);
    const attempts = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.invoiceId, invoiceId));
    expect(attempts.filter((x) => x.status === 'open')).toHaveLength(1);
    const paid = await payLatest(pia.userId);
    const d = await myInvoice(db(), pia, invoiceId);
    expect(d.state).toBe('paid');
    // Its pay link now says it's paid, on the invoice itself.
    expect(await resumeCheckoutUrl(db(), pia, paid.id)).toEqual({
      url: null,
      reason: 'already-paid',
      to: `/account/invoices/${invoiceId}?payment=already-paid`,
    });
    expect(d.payments[0]).toMatchObject({ method: 'stripe', amountPence: 9600 });
    await expect(startInvoiceCheckout(db(), pia, invoiceId)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('webhooks (non-negotiable 3)', () => {
  it('rejects bad signatures, completes checkouts, and ignores repeats', async () => {
    const date = weekdayAhead(47);
    await requestAndApprove(db(), quinn, { dogIds: [quinnDog], dates: [date], session: 'pm', taxi: false }, owner);
    const [a] = await attemptsFor(quinn.userId);
    stripe.pay(a!.providerSessionId!);
    const body = JSON.stringify({
      id: 'evt_test_1',
      type: 'checkout.session.completed',
      objectId: a!.providerSessionId,
    });
    await expect(handleWebhook(db(), body, 'forged')).rejects.toThrow(/signature/);
    expect(await handleWebhook(db(), body, 'valid')).toEqual({ duplicate: false });
    expect(await handleWebhook(db(), body, 'valid')).toEqual({ duplicate: true });
    const [done] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, a!.id));
    expect(done!.status).toBe('paid');
    const pays = await db().select().from(payments).where(eq(payments.checkoutAttemptId, a!.id));
    expect(pays).toHaveLength(1);
    const [evt] = await db().select().from(webhookEvents).where(eq(webhookEvents.eventId, 'evt_test_1'));
    expect(evt!.attempts).toBe(2);
    expect(evt!.processedAt).not.toBeNull();
  });
});

describe('a pay link for a booking that is already paid', () => {
  let rae: TestUser;
  let raeDog: string;
  beforeAll(async () => {
    rae = await makeUser(db(), 'customer', 'Rae Repaid');
    await readyCustomer(db(), rae);
    raeDog = await approvedDog(db(), owner, rae, 'Pickle');
  });

  it('says it is paid and links to the receipt, not "the time to pay ran out"', async () => {
    await requestAndApprove(
      db(),
      rae,
      { dogIds: [raeDog], dates: [weekdayAhead(46)], session: 'full', taxi: false },
      owner,
    );
    const a = await payLatest(rae.userId);
    const [paid] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, a.id));
    expect(paid!.status).toBe('paid');
    const to = `/account/bookings?payment=already-paid&receipt=${paid!.resultInvoiceId}`;

    // "Pay now" for the booking (pay-booking route) and the emailed link for the checkout (pay route).
    expect(await payForMyBooking(db(), rae, a.bookingId!)).toEqual({ url: null, reason: 'already-paid', to });
    expect(await resumeCheckoutUrl(db(), rae, a.id)).toEqual({ url: null, reason: 'already-paid', to });
    // Still the customer's own booking only.
    await expect(payForMyBooking(db(), pia, a.bookingId!)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a booking whose places lapsed unpaid still says the time ran out', async () => {
    await requestAndApprove(
      db(),
      rae,
      { dogIds: [raeDog], dates: [weekdayAhead(47)], session: 'full', taxi: false },
      owner,
    );
    const [open] = await attemptsFor(rae.userId);
    await releaseExpiredCheckouts(db(), new Date(open!.expiresAt.getTime() + 60_000));
    expect(await payForMyBooking(db(), rae, open!.bookingId!)).toEqual({
      url: null,
      reason: 'expired',
      to: '/account/bookings?payment=expired',
    });
  });
});
