import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import {
  bookingDogs,
  creditNotes,
  documentSequences,
  invoiceLines,
  invoices,
  jobRuns,
  payments,
  refundRequests,
} from '@/infra/db/schema';
import { requestMembership, approveMembership } from '@/server/services/memberships';
import { cancelMyBooking } from '@/server/services/bookings';
import {
  approveInvoice,
  decideRefund,
  issueCreditNote,
  loadBusinessSettings,
  myInvoice,
  myInvoices,
  ownerInvoice,
  ownerInvoices,
  recordManualPayment,
  refreshMembershipDrafts,
  sendDueInvoices,
  sendPaymentReminders,
  unapproveInvoice,
  updateBusinessSettings,
} from '@/server/services/billing';
import { invoicePdf } from '@/server/services/invoice-document';
import { runTick } from '@/server/services/jobs';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { AuthorizationError } from '@/server/policy/authorize';
import { addMonths, formatDocumentNumber, monthOf, monthRange } from '@/domain/billing/rules';
import { addDays, londonDate, londonInstant } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer, releaseMemberDays } from '../support/onboard';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const today = londonDate(new Date());
const M0 = monthOf(today);
const M1 = addMonths(M0, 1);
/** "The 26th of this month, 10:00" – after the draft day, before the send day. */
const on26 = londonInstant(`${M0}-26`, '10:00');
const sendTime = londonInstant(`${M0}-28`, '09:00');
const afterSend = new Date(sendTime.getTime() + 5 * 60_000);

let owner: TestUser;
let mia: TestUser;
let noah: TestUser;
let miaDog: string;

const BUSINESS = {
  tradingName: 'Luna’s K9 Club',
  legalName: 'Luna’s K9 Club Ltd',
  companyNumber: '12345678',
  registeredOffice: '1 Test Lane\nShefford\nSG17 5AA',
  contactEmail: 'hello@lunak9club.test',
  contactPhone: '01234 567890',
  invoicePrefix: 'LK9DOUGIE-',
  paymentTermsDays: '5',
  reminderAfterDays: '4',
  reminderTime: '15:30',
  draftDay: '25',
  sendDay: '28',
  sendTime: '09:00',
};

/** The number the next document of this kind will get (other test files may have issued some). */
async function nextNumber(key: 'invoice' | 'credit_note') {
  const [row] = await db().select().from(documentSequences).where(eq(documentSequences.key, key));
  const prefix = key === 'invoice' ? 'LK9DOUGIE-' : 'LK9DOUGIE-CN-';
  return formatDocumentNumber(prefix, row?.nextValue ?? 1);
}
let invoiceNo = '';

/** Database errors arrive wrapped by Drizzle; the trigger's message is on the cause. */
async function failsWith(p: PromiseLike<unknown>, re: RegExp) {
  const err = (await Promise.resolve(p).then(
    () => null,
    (e: unknown) => e,
  )) as (Error & { cause?: Error }) | null;
  expect(err, 'expected the database to refuse').not.toBeNull();
  expect(`${err?.message} ${err?.cause?.message ?? ''}`).toMatch(re);
}

async function draftFor(customerUserId: string, month: string) {
  const all = await ownerInvoices(db(), owner, 'draft', on26);
  return all.find(
    (r) =>
      r.inv.periodMonth === month && r.customerName === (customerUserId === mia.userId ? 'Mia Member' : 'Noah Other'),
  );
}

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Olive Owner');
  mia = await makeUser(db(), 'customer', 'Mia Member');
  noah = await makeUser(db(), 'customer', 'Noah Other');
  await readyCustomer(db(), mia);
  await readyCustomer(db(), noah);
  miaDog = await approvedDog(db(), owner, mia, 'Pepper');
  // Mon, Wed and Fri full days from tomorrow: 3 days a week → £48 a day (D3).
  const r = await requestMembership(db(), mia, {
    dogId: miaDog,
    weekdays: [1, 3, 5],
    session: 'full',
    startsOn: addDays(today, 1),
  });
  const [m] = await db()
    .execute<{ version: number }>(sql`select version from memberships where id = ${r.id}`)
    .then((x) => x.rows);
  await approveMembership(db(), owner, r.id, { version: m!.version });
});
afterAll(async () => {
  await releaseMemberDays(db());
  setEmailProvider(undefined);
  await closeDb();
});

describe('membership invoice drafts (D24, D52)', () => {
  it('builds next month’s draft from booked member days at the locked price', async () => {
    await refreshMembershipDrafts(db(), owner, {}, on26);
    const d = await draftFor(mia.userId, M1);
    expect(d).toBeDefined();
    const detail = await ownerInvoice(db(), owner, d!.inv.id, on26);
    const { first, last } = monthRange(M1);
    const expectedDays = (
      await db()
        .select()
        .from(bookingDogs)
        .where(
          and(
            eq(bookingDogs.dogId, miaDog),
            eq(bookingDogs.status, 'confirmed'),
            sql`${bookingDogs.serviceDate} between ${first} and ${last}`,
          ),
        )
    ).length;
    expect(detail.lines.length).toBe(expectedDays);
    expect(detail.lines.every((l) => l.amountPence === 4800)).toBe(true);
    expect(detail.inv.totalPence).toBe(4800 * expectedDays);
    expect(detail.inv.number).toBeNull();
  });

  it('is idempotent: refreshing again keeps one draft with the same lines', async () => {
    await refreshMembershipDrafts(db(), owner, {}, on26);
    await refreshMembershipDrafts(db(), owner, {}, on26);
    const drafts = await db()
      .select()
      .from(invoices)
      .where(and(eq(invoices.periodMonth, M1), eq(invoices.status, 'draft')));
    expect(drafts.filter((x) => x.totalPence > 0).length).toBe(1);
  });

  it('customers never see drafts, and can’t open other people’s invoices', async () => {
    expect(await myInvoices(db(), mia)).toEqual([]);
    const d = await draftFor(mia.userId, M1);
    await expect(myInvoice(db(), mia, d!.inv.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(ownerInvoices(db(), mia)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('won’t approve until the business details the law requires are filled in', async () => {
    const d = await draftFor(mia.userId, M1);
    await expect(
      approveInvoice(db(), owner, d!.inv.id, { version: d!.inv.version, expectedTotalPence: d!.inv.totalPence }, on26),
    ).rejects.toThrow(/company number/);
    await updateBusinessSettings(db(), owner, BUSINESS);
  });

  it('refuses to approve if the draft changed since the Owner looked at it', async () => {
    const d = await draftFor(mia.userId, M1);
    await expect(
      approveInvoice(db(), owner, d!.inv.id, { version: d!.inv.version, expectedTotalPence: 1 }, on26),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('approve, send and remind (D24, D25)', () => {
  let invoiceId: string;

  it('approving on the 26th waits for the 28th at 09:00; back to draft is allowed until then', async () => {
    const d = await draftFor(mia.userId, M1);
    invoiceId = d!.inv.id;
    const r = await approveInvoice(
      db(),
      owner,
      invoiceId,
      { version: d!.inv.version, expectedTotalPence: d!.inv.totalPence },
      on26,
    );
    expect(r.sentNow).toBe(false);
    expect(r.scheduledFor.toISOString()).toBe(sendTime.toISOString());
    const [row] = await db().select().from(invoices).where(eq(invoices.id, invoiceId));
    await unapproveInvoice(db(), owner, invoiceId, { version: row!.version });
    const again = await ownerInvoice(db(), owner, invoiceId, on26);
    await approveInvoice(
      db(),
      owner,
      invoiceId,
      { version: again.inv.version, expectedTotalPence: again.inv.totalPence },
      on26,
    );
    expect((await sendDueInvoices(db(), owner, on26)).sent).toBe(0);
  });

  it('sends on the 28th with the first number, due 5 days later, once only', async () => {
    mail.sent.length = 0;
    invoiceNo = await nextNumber('invoice');
    expect((await sendDueInvoices(db(), owner, afterSend)).sent).toBe(1);
    expect((await sendDueInvoices(db(), owner, afterSend)).sent).toBe(0);
    const [row] = await db().select().from(invoices).where(eq(invoices.id, invoiceId));
    expect(row!.number).toBe(invoiceNo);
    expect(invoiceNo).toMatch(/^LK9DOUGIE-\d{2,}$/);
    expect(row!.issueDate).toBe(`${M0}-28`);
    expect(row!.dueDate).toBe(addDays(`${M0}-28`, 5));
    expect(row!.reminderDueAt!.toISOString()).toBe(londonInstant(addDays(`${M0}-28`, 4), '15:30').toISOString());
    expect(row!.billToName).toBe('Mia Member');
    expect(row!.sellerDetails?.companyNumber).toBe('12345678');
    const email = mail.sent.find((m) => m.template === 'invoice.issued');
    expect(email?.to).toBe(mia.email);
    expect(email?.subject).toContain(invoiceNo);
    // No sensitive dog details in the email.
    expect(email?.text).not.toMatch(/allerg|medic|behaviour/i);
  });

  it('locks the sent invoice and its lines (corrections are credit notes)', async () => {
    await failsWith(db().update(invoices).set({ totalPence: 1 }).where(eq(invoices.id, invoiceId)), /locked/);
    await failsWith(db().delete(invoices).where(eq(invoices.id, invoiceId)), /only draft invoices/);
    await failsWith(
      db().update(invoiceLines).set({ amountPence: 1 }).where(eq(invoiceLines.invoiceId, invoiceId)),
      /locked/,
    );
    await failsWith(
      db().insert(invoiceLines).values({ invoiceId, position: 99, description: 'Sneaky', amountPence: 100 }),
      /locked/,
    );
  });

  it('the invoice prefix can no longer change', async () => {
    await expect(
      updateBusinessSettings(db(), owner, { ...BUSINESS, invoicePrefix: 'LK9DOGGIE-' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('the customer sees it and can download a PDF; nobody else can', async () => {
    const mine = await myInvoices(db(), mia);
    expect(mine.map((m) => m.inv.number)).toEqual([invoiceNo]);
    await expect(myInvoice(db(), noah, invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    const pdf = await invoicePdf(db(), mia, invoiceId);
    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.filename).toBe(`${invoiceNo}.pdf`);
    await expect(invoicePdf(db(), noah, invoiceId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sends one payment reminder at 15:30 on day 4 if unpaid', async () => {
    const before = londonInstant(addDays(`${M0}-28`, 4), '15:29');
    const at = londonInstant(addDays(`${M0}-28`, 4), '15:31');
    expect((await sendPaymentReminders(db(), owner, before)).sent).toBe(0);
    mail.sent.length = 0;
    expect((await sendPaymentReminders(db(), owner, at)).sent).toBe(1);
    expect((await sendPaymentReminders(db(), owner, at)).sent).toBe(0);
    expect(mail.sent.filter((m) => m.template === 'invoice.reminder')).toHaveLength(1);
  });

  it('is overdue after the due date', async () => {
    const late = londonInstant(addDays(`${M0}-28`, 6), '10:00');
    const d = await ownerInvoice(db(), owner, invoiceId, late);
    expect(d.state).toBe('overdue');
  });
});

describe('refunds and credit notes (D18, D54, D55)', () => {
  let invoiceId: string;
  const lastMemberDay = async () => {
    const { first, last } = monthRange(M1);
    const rows = await db()
      .select()
      .from(bookingDogs)
      .where(
        and(
          eq(bookingDogs.dogId, miaDog),
          eq(bookingDogs.status, 'confirmed'),
          sql`${bookingDogs.serviceDate} between ${first} and ${last}`,
        ),
      )
      .orderBy(sql`${bookingDogs.serviceDate} desc`);
    return rows;
  };

  beforeAll(async () => {
    const [row] = await db().select().from(invoices).where(eq(invoices.number, invoiceNo));
    invoiceId = row!.id;
  });

  it('cancelling an invoiced member day 48 h+ ahead raises a refund request', async () => {
    const [day] = await lastMemberDay();
    const r = await cancelMyBooking(db(), mia, day!.id, londonInstant(addDays(day!.serviceDate, -5), '10:00'));
    expect(r.late).toBe(false);
    const reqs = await db().select().from(refundRequests).where(eq(refundRequests.bookingDogId, day!.id));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.amountPence).toBe(4800);
  });

  it('a late cancellation raises no refund (the day stays charged)', async () => {
    const [, day] = await lastMemberDay();
    const r = await cancelMyBooking(db(), mia, day!.id, londonInstant(addDays(day!.serviceDate, -1), '10:00'));
    expect(r.late).toBe(true);
    expect(await db().select().from(refundRequests).where(eq(refundRequests.bookingDogId, day!.id))).toHaveLength(0);
  });

  it('approving the refund issues a credit note that reduces what’s owed', async () => {
    const before = await ownerInvoice(db(), owner, invoiceId);
    const [req] = await db()
      .select()
      .from(refundRequests)
      .where(and(eq(refundRequests.status, 'requested'), eq(refundRequests.invoiceId, invoiceId)));
    const cnNo = await nextNumber('credit_note');
    await expect(decideRefund(db(), mia, req!.id, true, {})).rejects.toBeInstanceOf(AuthorizationError);
    await decideRefund(db(), owner, req!.id, true, {});
    const after = await ownerInvoice(db(), owner, invoiceId);
    expect(after.bal.creditedPence).toBe(4800);
    expect(after.bal.duePence).toBe(before.bal.duePence - 4800);
    expect(after.creditNotes[0]!.number).toBe(cnNo);
    expect(after.creditNotes[0]!.refundState).toBe('none'); // unpaid, so nothing to send back
    await expect(decideRefund(db(), owner, req!.id, true, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it('records a manual payment (card only for customers; Owner can record by hand with a reason)', async () => {
    const d = await ownerInvoice(db(), owner, invoiceId);
    await expect(
      recordManualPayment(db(), owner, invoiceId, { amount: '999999', receivedOn: today, reason: 'test' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      recordManualPayment(db(), owner, invoiceId, {
        amount: (d.bal.duePence / 100).toFixed(2),
        receivedOn: today,
        reason: '',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await recordManualPayment(db(), owner, invoiceId, {
      amount: (d.bal.duePence / 100).toFixed(2),
      receivedOn: today,
      reason: 'Paid in person during testing',
    });
    const after = await ownerInvoice(db(), owner, invoiceId);
    expect(after.state).toBe('paid');
    expect(after.inv.status).toBe('paid');
    await failsWith(
      db().update(payments).set({ amountPence: 1 }).where(eq(payments.invoiceId, invoiceId)),
      /append-only/,
    );
  });

  it('crediting a paid invoice marks the money as owed back to the customer', async () => {
    const d = await ownerInvoice(db(), owner, invoiceId);
    const line = d.lines.find((l) => !l.creditedBy)!;
    const cnNo = await nextNumber('credit_note');
    await issueCreditNote(db(), owner, invoiceId, { lineIds: [line.id], reason: 'Goodwill – closed early' });
    const after = await ownerInvoice(db(), owner, invoiceId);
    const cn = after.creditNotes.at(-1)!;
    expect(cn.number).toBe(cnNo);
    expect(cn.refundState).toBe('awaiting_refund');
    expect(cn.refundDuePence).toBe(line.amountPence);
    await expect(
      issueCreditNote(db(), owner, invoiceId, { lineIds: [line.id], reason: 'again' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await failsWith(db().update(creditNotes).set({ amountPence: 1 }).where(eq(creditNotes.id, cn.id)), /locked/);
  });
});

describe('scheduled jobs (non-negotiable 3)', () => {
  it('runs each daily job once however often the scheduler ticks', async () => {
    const tick = londonInstant(`${M0}-27`, '03:00');
    const system = { kind: 'system', job: 'test' } as const;
    const a = await runTick(db(), system, tick);
    const b = await runTick(db(), system, tick);
    expect(a.jobs.filter((j) => j.status === 'ran').map((j) => j.job)).toEqual(
      expect.arrayContaining(['membership-book-ahead', 'invoice-drafts', 'drafts-ready-email']),
    );
    expect(b.jobs.every((j) => j.status === 'skipped')).toBe(true);
    const runs = await db()
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.runKey, `${M0}-27`));
    expect(runs.every((r) => r.status === 'succeeded')).toBe(true);
    await expect(runTick(db(), mia, tick)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('keeps business settings valid', async () => {
    const bs = await loadBusinessSettings(db());
    expect(bs.invoicePrefix).toBe('LK9DOUGIE-');
  });
});
