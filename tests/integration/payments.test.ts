import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { setPaymentProvider } from '@/infra/payments';
import { SimulatedPaymentProvider } from '@/infra/payments/simulated';
import type { WebhookEvent } from '@/infra/payments/types';
import {
  bookingDogs,
  cardRefunds,
  checkoutAttempts,
  creditNotes,
  customers,
  invoiceLines,
  invoices,
  payments,
  webhookEvents,
} from '@/infra/db/schema';
import { acceptOffer, cancelMyBooking, createMyBookings } from '@/server/services/bookings';
import { offerPlace, ownerCreateBooking, setDayCapacity } from '@/server/services/owner-bookings';
import { issueTx, myInvoice, ownerInvoice } from '@/server/services/billing';
import {
  completeCheckout,
  handleWebhook,
  releaseExpiredCheckouts,
  resumeCheckoutUrl,
  startInvoiceCheckout,
} from '@/server/services/payments';
import { ownerCardRefunds, retryCardRefund, submitPendingRefunds } from '@/server/services/card-refunds';
import { ConflictError, NotFoundError } from '@/server/errors';
import { AuthorizationError } from '@/server/policy/authorize';
import { isoWeekday } from '@/domain/booking/rules';
import { addDays, londonDate } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer } from '../support/onboard';

/** Simulated Stripe that also accepts "signed" test webhooks (signature must be "valid"). */
class TestProvider extends SimulatedPaymentProvider {
  /** Make refunds go through but lose the answer, like a timeout after Stripe created them. */
  loseRefundAnswers = false;
  override async refund(paymentId: string, amountPence: number, key: string, reference: string) {
    const res = await super.refund(paymentId, amountPence, key, reference);
    return this.loseRefundAnswers
      ? { id: '', status: 'pending' as const, failureReason: 'StripeConnectionError: timed out' }
      : res;
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
const used = new Set<string>();
/** Distinct open weekdays well away from other test files' dates. */
function weekdayAhead(n: number): string {
  let d = addDays(today, n);
  while (isoWeekday(d) > 5 || ['2026-12-25', '2026-12-28', '2027-01-01'].includes(d) || used.has(d)) d = addDays(d, 1);
  used.add(d);
  return d;
}

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
    const r = await createMyBookings(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false });
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
    await createMyBookings(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false });
    const q = await createMyBookings(db(), quinn, {
      dogIds: [quinnDog],
      dates: [date],
      session: 'full',
      taxi: false,
      ifFull: 'skip',
    });
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
    await createMyBookings(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false });
    const [a] = await attemptsFor(pia.userId);
    // Quinn takes the place once Pia's hold has lapsed (simulated by a confirmed row).
    await db().execute(
      sql`update booking_dogs set offer_expires_at = now() - interval '1 minute' where booking_id = ${a!.bookingId}`,
    );
    await createMyBookings(db(), quinn, { dogIds: [quinnDog], dates: [date], session: 'full', taxi: false });
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
    await createMyBookings(db(), pia, { dogIds: [piaDog], dates: [date], session: 'am', taxi: false });
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
    await offerPlace(db(), owner, w1.id, { version: w1.version });
    await offerPlace(db(), owner, w2.id, { version: w2.version });

    // Both accepted within the hold: two open checkouts on one bookingId, one day each.
    await acceptOffer(db(), quinn, w1.id);
    await acceptOffer(db(), quinn, w2.id);
    const [second, first] = await attemptsFor(quinn.userId);
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
    const d1 = weekdayAhead(53);
    const d2 = weekdayAhead(54);
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
    await offerPlace(db(), owner, w1.id, { version: w1.version });
    await offerPlace(db(), owner, w2.id, { version: w2.version });
    const t0 = new Date();
    await acceptOffer(db(), quinn, w1.id, t0);
    await acceptOffer(db(), quinn, w2.id, new Date(t0.getTime() + 20 * 60_000));
    // 32 minutes on: the first checkout has run out, the second still has ~19 minutes.
    await releaseExpiredCheckouts(db(), new Date(t0.getTime() + 32 * 60_000));
    expect((await row(d1)).status).toBe('cancelled');
    expect((await row(d2)).status).toBe('pending_payment');
  });
});

describe('automatic refunds (D20, D58)', () => {
  it('a paid day cancelled 48 h+ ahead goes back to the card, with a credit note', async () => {
    const date = weekdayAhead(44);
    await createMyBookings(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false });
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
    await createMyBookings(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false });
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

  it('a refund whose answer was lost stays pending, and the webhook settles it by our id without a second refund', async () => {
    const date = weekdayAhead(47);
    await createMyBookings(db(), pia, { dogIds: [piaDog], dates: [date], session: 'full', taxi: false });
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
    await payLatest(pia.userId);
    const d = await myInvoice(db(), pia, invoiceId);
    expect(d.state).toBe('paid');
    expect(d.payments[0]).toMatchObject({ method: 'stripe', amountPence: 9600 });
    await expect(startInvoiceCheckout(db(), pia, invoiceId)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('webhooks (non-negotiable 3)', () => {
  it('rejects bad signatures, completes checkouts, and ignores repeats', async () => {
    const date = weekdayAhead(47);
    await createMyBookings(db(), quinn, { dogIds: [quinnDog], dates: [date], session: 'pm', taxi: false });
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
