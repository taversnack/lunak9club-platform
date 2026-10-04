import 'server-only';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import {
  bookingDogs,
  businessSettings,
  creditNoteLines,
  creditNotes,
  customers,
  documentSequences,
  dogs,
  invoiceLines,
  invoices,
  payments,
  priceSnapshots,
  refundRequests,
  users,
  type SellerSnapshot,
} from '@/infra/db/schema';
import {
  balanceOf,
  billingMonths,
  creditNotePrefix,
  formatDocumentNumber,
  formatMonth,
  lineDescription,
  monthRange,
  paymentDates,
  paymentState,
  refundDueForCredit,
  sendTimeFor,
  statusAfter,
  type Balance,
  type Month,
} from '@/domain/billing/rules';
import { pounds } from '@/domain/pricing/engine';
import { formatUkDate, isIsoDate, londonDate } from '@/domain/time';
import {
  invoiceIssuedMessage,
  ownerBillingMessage,
  paymentReminderMessage,
  refundDecisionMessage,
} from '@/infra/email/templates';
import { assertAuthorized, hasPermission, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { appUrl, firstNameOf, ownerEmails, sendSafely } from '../notify';
import { idOrNotFound, isoDate, parseInput, requiredText } from '../validation';
import { asUser, getMyCustomer } from './customers';
import { queueCardRefunds, submitPendingRefunds } from './card-refunds';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

/** Member days that are billed: attended or booked, plus late cancellations and no-shows (D8, D18). */
const BILLABLE = sql`(${bookingDogs.status} in ('confirmed', 'attended', 'no_show') or (${bookingDogs.status} = 'cancelled' and ${bookingDogs.lateCancellation}))`;

// ---- Business details (D51) ---------------------------------------------------------

export async function loadBusinessSettings(q: Q) {
  const [row] = await q.select().from(businessSettings).where(eq(businessSettings.id, 1));
  if (!row) throw new Error('business_settings row missing – run migrations');
  return row;
}

export type BusinessSettings = Awaited<ReturnType<typeof loadBusinessSettings>>;

/** Details UK law expects on a limited company's invoices (Companies Act trading disclosures). */
export function missingBusinessDetails(bs: BusinessSettings): string[] {
  const missing: string[] = [];
  if (!bs.legalName.trim()) missing.push('registered company name');
  if (!bs.companyNumber.trim()) missing.push('company number');
  if (!bs.registeredOffice.trim()) missing.push('registered office address');
  if (!bs.contactEmail.trim()) missing.push('contact email');
  return missing;
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the 24-hour clock, like 09:00');
export const BusinessSettingsInput = z
  .object({
    tradingName: requiredText('the trading name', 100),
    legalName: requiredText('the registered company name', 150),
    companyNumber: z
      .string()
      .trim()
      .toUpperCase()
      .refine((v) => v === '' || /^(\d{8}|[A-Z]{2}\d{6})$/.test(v), 'Company numbers are 8 characters, like 12345678'),
    registeredOffice: z.string().trim().max(400, 'Keep this under 400 characters'),
    contactEmail: z
      .string()
      .trim()
      .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter an email address, like hello@example.com'),
    contactPhone: z.string().trim().max(30),
    invoicePrefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/, 'Use capital letters, numbers and dashes (up to 16)'),
    paymentTermsDays: z.coerce.number().int().min(0).max(60),
    reminderAfterDays: z.coerce.number().int().min(1).max(60),
    reminderTime: hhmm,
    draftDay: z.coerce.number().int().min(1).max(28),
    sendDay: z.coerce.number().int().min(1).max(28),
    sendTime: hhmm,
  })
  .refine((v) => v.sendDay >= v.draftDay, { path: ['sendDay'], message: 'Send on or after the draft day' });

export async function updateBusinessSettings(db: Db, actor: Actor, input: unknown) {
  assertAuthorized(actor, 'settings.manage');
  const d = parseInput(BusinessSettingsInput, input);
  await db.transaction(async (tx) => {
    const current = await loadBusinessSettings(tx);
    if (d.invoicePrefix !== current.invoicePrefix) {
      const [seq] = await tx
        .select({ n: documentSequences.nextValue })
        .from(documentSequences)
        .where(eq(documentSequences.key, 'invoice'))
        .for('update');
      if ((seq?.n ?? 1) > 1)
        throw new ValidationError('Please check the highlighted fields.', {
          invoicePrefix: 'The prefix can’t change once invoices have been sent – numbers must stay in one sequence',
        });
    }
    await tx.update(businessSettings).set(d).where(eq(businessSettings.id, 1));
    await recordAudit(tx, {
      actor,
      action: 'settings.business_updated',
      entityType: 'business_settings',
      entityId: '1',
      metadata: { prefixChanged: d.invoicePrefix !== current.invoicePrefix },
    });
  });
}

const sellerSnapshot = (bs: BusinessSettings): SellerSnapshot => ({
  tradingName: bs.tradingName,
  legalName: bs.legalName,
  companyNumber: bs.companyNumber,
  registeredOffice: bs.registeredOffice,
  contactEmail: bs.contactEmail,
  contactPhone: bs.contactPhone,
});

// ---- Drafts (D24, D52) --------------------------------------------------------------

/**
 * Rebuild one customer's draft for a month from their billable member days that aren't on any
 * other invoice. Creates the draft if needed and deletes it if nothing is left. Serialised per
 * customer and month with an advisory lock so two runs can't bill a day twice.
 */
async function rebuildDraft(tx: Tx, customerId: string, month: Month) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`invoice:${customerId}:${month}`}))`);
  const [draft] = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.customerId, customerId),
        eq(invoices.periodMonth, month),
        eq(invoices.status, 'draft'),
        eq(invoices.kind, 'membership'),
      ),
    )
    .for('update');
  if (draft) await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, draft.id));
  const { first, last } = monthRange(month);
  const days = await tx
    .select({
      bookingDogId: bookingDogs.id,
      serviceDate: bookingDogs.serviceDate,
      session: bookingDogs.session,
      taxi: bookingDogs.taxi,
      dogName: dogs.name,
      totalPence: priceSnapshots.totalPence,
      explanation: priceSnapshots.explanation,
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .innerJoin(priceSnapshots, eq(priceSnapshots.bookingDogId, bookingDogs.id))
    .leftJoin(invoiceLines, eq(invoiceLines.bookingDogId, bookingDogs.id))
    .where(
      and(
        eq(bookingDogs.customerId, customerId),
        eq(bookingDogs.kind, 'membership'),
        gte(bookingDogs.serviceDate, first),
        lte(bookingDogs.serviceDate, last),
        BILLABLE,
        isNull(invoiceLines.id),
      ),
    )
    .orderBy(asc(bookingDogs.serviceDate), asc(dogs.name));
  if (!days.length) {
    if (draft) await tx.delete(invoices).where(eq(invoices.id, draft.id));
    return { invoiceId: null, totalPence: 0, lines: 0, created: false, removed: Boolean(draft) };
  }
  const total = days.reduce((a, d) => a + d.totalPence, 0);
  let invoiceId = draft?.id;
  if (draft) {
    await tx
      .update(invoices)
      .set({ totalPence: total, version: draft.version + 1 })
      .where(eq(invoices.id, draft.id));
  } else {
    const [row] = await tx
      .insert(invoices)
      .values({ customerId, periodMonth: month, status: 'draft', totalPence: total })
      .returning({ id: invoices.id });
    invoiceId = row!.id;
  }
  await tx.insert(invoiceLines).values(
    days.map((d, i) => ({
      invoiceId: invoiceId!,
      bookingDogId: d.bookingDogId,
      position: i + 1,
      serviceDate: d.serviceDate,
      description: lineDescription(d.dogName, d.serviceDate, d.session, d.taxi),
      explanation: d.explanation,
      amountPence: d.totalPence,
    })),
  );
  return { invoiceId: invoiceId!, totalPence: total, lines: days.length, created: !draft, removed: false };
}

/**
 * Create or refresh membership drafts for the billing months (last, this and – from the draft
 * day – next month). Idempotent; safe to run as often as needed.
 */
export async function refreshMembershipDrafts(
  db: Db,
  actor: Actor,
  opts: { customerId?: string } = {},
  now = new Date(),
) {
  assertAuthorized(actor, 'invoices.manage');
  const bs = await loadBusinessSettings(db);
  const months = billingMonths(londonDate(now), bs);
  const from = monthRange(months[0]!).first;
  const to = monthRange(months.at(-1)!).last;
  const candidates = await db
    .selectDistinct({
      customerId: bookingDogs.customerId,
      month: sql<string>`to_char(${bookingDogs.serviceDate}, 'YYYY-MM')`,
    })
    .from(bookingDogs)
    .leftJoin(invoiceLines, eq(invoiceLines.bookingDogId, bookingDogs.id))
    .leftJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .where(
      and(
        eq(bookingDogs.kind, 'membership'),
        gte(bookingDogs.serviceDate, from),
        lte(bookingDogs.serviceDate, to),
        opts.customerId ? eq(bookingDogs.customerId, opts.customerId) : undefined,
        or(isNull(invoiceLines.id), eq(invoices.status, 'draft')),
      ),
    );
  const drafts = await db
    .select({ customerId: invoices.customerId, month: invoices.periodMonth })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, 'draft'),
        eq(invoices.kind, 'membership'),
        inArray(invoices.periodMonth, months),
        opts.customerId ? eq(invoices.customerId, opts.customerId) : undefined,
      ),
    );
  const pairs = new Map<string, { customerId: string; month: Month }>();
  for (const p of [...candidates, ...drafts]) pairs.set(`${p.customerId}:${p.month}`, p);
  const result = { months, drafts: 0, created: 0, removed: 0, totalPence: 0 };
  for (const p of pairs.values()) {
    const r = await db.transaction((tx) => rebuildDraft(tx, p.customerId, p.month));
    if (r.invoiceId) {
      result.drafts++;
      result.totalPence += r.totalPence;
      if (r.created) result.created++;
    } else if (r.removed) result.removed++;
  }
  if (result.created || result.removed) {
    await recordAudit(db, {
      actor,
      action: 'invoice.drafts_refreshed',
      entityType: 'invoice',
      metadata: { created: result.created, removed: result.removed, drafts: result.drafts },
    });
  }
  return result;
}

// ---- Approve, issue and send ---------------------------------------------------------

export const ApproveInput = z.object({
  version: z.coerce.number().int().positive(),
  expectedTotalPence: z.coerce.number().int().min(0),
});

/**
 * Owner approves a draft (D24). The draft is rebuilt first; if the total changed since the Owner
 * looked at it, nothing is approved. Future-month invoices wait for the send day; others go now.
 */
export async function approveInvoice(db: Db, actor: Actor, rawId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  const d = parseInput(ApproveInput, input);
  const id = idOrNotFound(rawId, 'Invoice');
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!inv) throw new NotFoundError('Invoice');
  if (inv.status !== 'draft') throw new ConflictError('This invoice has already been approved.');
  if (inv.version !== d.version) throw new ConflictError('This draft changed. Please check it again.');
  const bs = await loadBusinessSettings(db);
  const missing = missingBusinessDetails(bs);
  if (missing.length)
    throw new ConflictError(`Add your ${missing.join(', ')} in Settings → Business before sending invoices.`);

  const scheduledFor = sendTimeFor(inv.periodMonth, now, bs);
  await db.transaction(async (tx) => {
    const rebuilt = await rebuildDraft(tx, inv.customerId, inv.periodMonth);
    if (rebuilt.invoiceId !== id)
      throw new ConflictError('The days on this draft have all been cancelled. There’s nothing to send.');
    if (rebuilt.totalPence !== d.expectedTotalPence)
      throw new ConflictError(
        `This draft changed since you opened it (now ${pounds(rebuilt.totalPence)}). Please check it again.`,
      );
    await tx
      .update(invoices)
      .set({
        status: 'scheduled',
        scheduledFor,
        approvedBy: actor.kind === 'user' ? actor.userId : null,
        approvedAt: now,
        version: sql`${invoices.version} + 1`,
      })
      .where(eq(invoices.id, id));
    await recordAudit(tx, {
      actor,
      action: 'invoice.approved',
      entityType: 'invoice',
      entityId: id,
      metadata: { totalPence: rebuilt.totalPence, month: inv.periodMonth, sendNow: scheduledFor <= now },
    });
  });
  if (scheduledFor <= now) await sendInvoice(db, actor, id, now);
  return { scheduledFor, sentNow: scheduledFor <= now };
}

/** Put an approved (not yet sent) invoice back to draft so it can be rebuilt. */
export async function unapproveInvoice(db: Db, actor: Actor, rawId: string, input: unknown) {
  assertAuthorized(actor, 'invoices.manage');
  const d = parseInput(z.object({ version: z.coerce.number().int().positive() }), input);
  const id = idOrNotFound(rawId, 'Invoice');
  await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
    if (!inv) throw new NotFoundError('Invoice');
    if (inv.status !== 'scheduled')
      throw new ConflictError('Only approved invoices that haven’t been sent can go back to draft.');
    if (inv.version !== d.version) throw new ConflictError('This invoice changed. Please reload.');
    const [other] = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, inv.customerId),
          eq(invoices.periodMonth, inv.periodMonth),
          eq(invoices.status, 'draft'),
        ),
      );
    if (other) throw new ConflictError('There’s already a draft for this customer and month. Approve that one first.');
    await tx
      .update(invoices)
      .set({ status: 'draft', scheduledFor: null, approvedBy: null, approvedAt: null, version: inv.version + 1 })
      .where(eq(invoices.id, id));
    await recordAudit(tx, { actor, action: 'invoice.unapproved', entityType: 'invoice', entityId: id });
  });
}

/**
 * Assign the next number and lock the invoice (inside the caller's transaction). Booking invoices
 * (paid at checkout) are issued even if business details are incomplete – the payment has happened.
 */
export async function issueTx(tx: Tx, id: string, now: Date, opts: { requireDetails?: boolean } = {}) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
  if (!inv) throw new NotFoundError('Invoice');
  if (inv.status !== 'scheduled') return null; // already issued by another run
  const bs = await loadBusinessSettings(tx);
  const missing = missingBusinessDetails(bs);
  if (missing.length && opts.requireDetails !== false)
    throw new ConflictError(`Business details missing: ${missing.join(', ')}`);
  const [seq] = await tx.select().from(documentSequences).where(eq(documentSequences.key, 'invoice')).for('update');
  const n = seq?.nextValue ?? 1;
  await tx
    .update(documentSequences)
    .set({ nextValue: n + 1 })
    .where(eq(documentSequences.key, 'invoice'));
  const [cust] = await tx
    .select({ name: users.name, c: customers })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, inv.customerId));
  const address = [cust?.c.addressLine1, cust?.c.addressLine2, cust?.c.town, cust?.c.postcode]
    .filter((v): v is string => Boolean(v && v.trim()))
    .join('\n');
  const dates = paymentDates(now, bs);
  const number = formatDocumentNumber(bs.invoicePrefix, n);
  await tx
    .update(invoices)
    .set({
      status: inv.totalPence === 0 ? 'paid' : 'issued',
      number,
      issuedAt: now,
      issueDate: dates.issueDate,
      dueDate: dates.dueDate,
      reminderDueAt: dates.reminderDueAt,
      billToName: cust?.name ?? 'Customer',
      billToAddress: address || null,
      sellerDetails: sellerSnapshot(bs),
      paidAt: inv.totalPence === 0 ? now : null,
      version: inv.version + 1,
    })
    .where(eq(invoices.id, id));
  await recordAudit(tx, {
    actor: { kind: 'system', job: 'invoice-issue' },
    action: 'invoice.issued',
    entityType: 'invoice',
    entityId: id,
    metadata: { number, totalPence: inv.totalPence, dueDate: dates.dueDate },
  });
  return {
    number,
    dueDate: dates.dueDate,
    totalPence: inv.totalPence,
    customerId: inv.customerId,
    month: inv.periodMonth,
  };
}

async function customerContact(q: Q, customerId: string) {
  const [row] = await q
    .select({ email: users.email, name: users.name, userId: users.id })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, customerId));
  return row;
}

/** Issue one approved invoice and email it. Safe to call twice: the second call does nothing. */
async function sendInvoice(db: Db, actor: Actor, id: string, now: Date) {
  const issued = await db.transaction(async (tx) => {
    const r = await issueTx(tx, id, now);
    if (r) await raiseRefundRequests(tx, { invoiceId: id });
    return r;
  });
  if (!issued) return false;
  const who = await customerContact(db, issued.customerId);
  if (who) {
    await sendSafely(
      invoiceIssuedMessage(
        who.email,
        firstNameOf(who.name),
        {
          number: issued.number,
          amountText: pounds(issued.totalPence),
          dueText: formatUkDate(issued.dueDate),
          periodText: formatMonth(issued.month),
        },
        appUrl(`/account/invoices/${id}`),
      ),
    );
    await db.update(invoices).set({ emailSentAt: new Date() }).where(eq(invoices.id, id));
  }
  await recordAudit(db, {
    actor,
    action: 'invoice.sent',
    entityType: 'invoice',
    entityId: id,
    metadata: { number: issued.number },
  });
  return true;
}

/** Send every approved invoice whose send time has come (the 28th 09:00 run, D24). */
export async function sendDueInvoices(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  const due = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.status, 'scheduled'), lte(invoices.scheduledFor, now)))
    .orderBy(asc(invoices.scheduledFor), asc(invoices.createdAt));
  let sent = 0;
  for (const { id } of due) if (await sendInvoice(db, actor, id, now)) sent++;
  return { sent };
}

/** Owner emails an issued invoice again (no change to the invoice). */
export async function resendInvoice(db: Db, actor: Actor, rawId: string) {
  assertAuthorized(actor, 'invoices.manage');
  const id = idOrNotFound(rawId, 'Invoice');
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!inv?.number || !inv.dueDate) throw new NotFoundError('Invoice');
  const bal = (await balances(db, [id])).get(id)!;
  const who = await customerContact(db, inv.customerId);
  if (who)
    await sendSafely(
      invoiceIssuedMessage(
        who.email,
        firstNameOf(who.name),
        {
          number: inv.number,
          amountText: pounds(bal.duePence),
          dueText: formatUkDate(inv.dueDate),
          periodText: formatMonth(inv.periodMonth),
        },
        appUrl(`/account/invoices/${id}`),
      ),
    );
  await recordAudit(db, { actor, action: 'invoice.resent', entityType: 'invoice', entityId: id });
}

/** One reminder at 15:30 on the 4th day if still unpaid (D25). Claimed before sending so it goes once. */
export async function sendPaymentReminders(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  const candidates = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.status, 'issued'), lte(invoices.reminderDueAt, now), isNull(invoices.reminderSentAt)));
  let sent = 0;
  const bals = await balances(
    db,
    candidates.map((c) => c.id),
  );
  for (const { id } of candidates) {
    if ((bals.get(id)?.duePence ?? 0) === 0) continue;
    const [claimed] = await db
      .update(invoices)
      .set({ reminderSentAt: now })
      .where(and(eq(invoices.id, id), isNull(invoices.reminderSentAt), eq(invoices.status, 'issued')))
      .returning();
    if (!claimed?.number || !claimed.dueDate) continue;
    const who = await customerContact(db, claimed.customerId);
    if (who)
      await sendSafely(
        paymentReminderMessage(
          who.email,
          firstNameOf(who.name),
          {
            number: claimed.number,
            amountText: pounds(bals.get(id)!.duePence),
            dueText: formatUkDate(claimed.dueDate),
            periodText: formatMonth(claimed.periodMonth),
          },
          appUrl(`/account/invoices/${id}`),
        ),
      );
    await recordAudit(db, { actor, action: 'invoice.reminder_sent', entityType: 'invoice', entityId: id });
    sent++;
  }
  return { sent };
}

// ---- Balances, payments, credit notes ------------------------------------------------

export async function balances(q: Q, ids: string[]): Promise<Map<string, Balance>> {
  const out = new Map<string, Balance>();
  if (!ids.length) return out;
  const [invs, paid, credited] = await Promise.all([
    q.select({ id: invoices.id, total: invoices.totalPence }).from(invoices).where(inArray(invoices.id, ids)),
    q
      .select({ id: payments.invoiceId, amount: sum(payments.amountPence).mapWith(Number) })
      .from(payments)
      .where(inArray(payments.invoiceId, ids))
      .groupBy(payments.invoiceId),
    q
      .select({ id: creditNotes.invoiceId, amount: sum(creditNotes.amountPence).mapWith(Number) })
      .from(creditNotes)
      .where(inArray(creditNotes.invoiceId, ids))
      .groupBy(creditNotes.invoiceId),
  ]);
  const p = new Map(paid.map((r) => [r.id, r.amount]));
  const c = new Map(credited.map((r) => [r.id, r.amount]));
  for (const i of invs) out.set(i.id, balanceOf(i.total, c.get(i.id) ?? 0, p.get(i.id) ?? 0));
  return out;
}

export async function lockIssued(tx: Tx, id: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
  if (!inv) throw new NotFoundError('Invoice');
  if (!inv.number) throw new ConflictError('This invoice hasn’t been sent yet.');
  return inv;
}

export async function settleTx(tx: Tx, id: string, now: Date) {
  const bal = (await balances(tx, [id])).get(id)!;
  const status = statusAfter(bal);
  await tx
    .update(invoices)
    .set({ status, paidAt: status === 'issued' ? null : now, version: sql`${invoices.version} + 1` })
    .where(eq(invoices.id, id));
  return { bal, status };
}

export const ManualPaymentInput = z.object({
  amount: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount in pounds, like 192.00')
    .transform((v) => Math.round(Number(v) * 100))
    .refine((v) => v > 0, 'Enter an amount above £0'),
  receivedOn: isoDate('the date it was paid'),
  reason: requiredText('why you’re recording this by hand', 300),
});

/**
 * Owner records a payment by hand (D53: card payments arrive in Phase 6; until then this is how an
 * invoice is marked paid). Can't exceed what's owed. Audited with the reason.
 */
export async function recordManualPayment(db: Db, actor: Actor, rawId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  const d = parseInput(ManualPaymentInput, input);
  const id = idOrNotFound(rawId, 'Invoice');
  if (d.receivedOn > londonDate(now))
    throw new ValidationError('Please check the highlighted fields.', {
      receivedOn: 'The date can’t be in the future',
    });
  return db.transaction(async (tx) => {
    const inv = await lockIssued(tx, id);
    if (inv.status === 'void') throw new ConflictError('This invoice has been cancelled with a credit note.');
    const bal = (await balances(tx, [id])).get(id)!;
    if (d.amount > bal.duePence)
      throw new ValidationError('Please check the highlighted fields.', {
        amount: `Only ${pounds(bal.duePence)} is still owed on this invoice`,
      });
    await tx.insert(payments).values({
      invoiceId: id,
      amountPence: d.amount,
      method: 'manual',
      receivedOn: d.receivedOn,
      reason: d.reason,
      recordedBy: actor.kind === 'user' ? actor.userId : null,
    });
    const r = await settleTx(tx, id, now);
    await recordAudit(tx, {
      actor,
      action: 'invoice.payment_recorded',
      entityType: 'invoice',
      entityId: id,
      metadata: { amountPence: d.amount, method: 'manual', status: r.status },
    });
    return r;
  });
}

/**
 * Create a credit note inside the caller's transaction (D55). If the invoice was already paid by
 * card, the money is queued to go back automatically (D58); call submitPendingRefunds after commit.
 */
export async function createCreditNoteTx(
  tx: Tx,
  actor: Actor,
  inv: { id: string; status: string },
  opts: { lines: { id: string; amountPence: number }[]; amountPence: number; reason: string },
  now: Date,
) {
  if (inv.status === 'void') throw new ConflictError('This invoice has already been fully credited.');
  const bal = (await balances(tx, [inv.id])).get(inv.id)!;
  const creditable = bal.totalPence - bal.creditedPence;
  if (opts.amountPence <= 0)
    throw new ValidationError('Please check the highlighted fields.', { amount: 'Enter an amount above £0' });
  if (opts.amountPence > creditable)
    throw new ValidationError('Please check the highlighted fields.', {
      amount: `Only ${pounds(creditable)} is left to credit on this invoice`,
    });
  const bs = await loadBusinessSettings(tx);
  const [seq] = await tx.select().from(documentSequences).where(eq(documentSequences.key, 'credit_note')).for('update');
  const n = seq?.nextValue ?? 1;
  await tx
    .update(documentSequences)
    .set({ nextValue: n + 1 })
    .where(eq(documentSequences.key, 'credit_note'));
  const refundDue = refundDueForCredit(bal, opts.amountPence);
  const number = formatDocumentNumber(creditNotePrefix(bs.invoicePrefix), n);
  const [cn] = await tx
    .insert(creditNotes)
    .values({
      invoiceId: inv.id,
      number,
      issueDate: londonDate(now),
      amountPence: opts.amountPence,
      reason: opts.reason,
      refundDuePence: refundDue,
      refundState: refundDue > 0 ? 'awaiting_refund' : 'none',
      createdBy: actor.kind === 'user' ? actor.userId : null,
    })
    .returning();
  if (opts.lines.length)
    await tx
      .insert(creditNoteLines)
      .values(opts.lines.map((l) => ({ creditNoteId: cn!.id, invoiceLineId: l.id, amountPence: l.amountPence })));
  const settled = await settleTx(tx, inv.id, now);
  if (refundDue > 0)
    await queueCardRefunds(tx, {
      invoiceId: inv.id,
      amountPence: refundDue,
      creditNoteId: cn!.id,
      reason: opts.reason,
    });
  await recordAudit(tx, {
    actor,
    action: 'invoice.credited',
    entityType: 'invoice',
    entityId: inv.id,
    metadata: { creditNote: number, amountPence: opts.amountPence, refundDuePence: refundDue, status: settled.status },
  });
  return cn!;
}

export const CreditInput = z.object({
  lineIds: z.array(z.string()).default([]),
  amount: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => v === undefined || /^\d+(\.\d{1,2})?$/.test(v), 'Enter an amount in pounds, like 48.00')
    .transform((v) => (v === undefined ? undefined : Math.round(Number(v) * 100))),
  reason: requiredText('a reason (shown on the credit note)', 300),
});

/** Owner credits whole lines, or a sum of money, off an issued invoice. */
export async function issueCreditNote(db: Db, actor: Actor, rawId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  const d = parseInput(CreditInput, input);
  const id = idOrNotFound(rawId, 'Invoice');
  const lineIds = [...new Set(d.lineIds.map((l) => idOrNotFound(l, 'Line')))];
  if (!lineIds.length && d.amount === undefined)
    throw new ValidationError('Please check the highlighted fields.', {
      lineIds: 'Choose the days to credit, or enter an amount',
    });
  if (lineIds.length && d.amount !== undefined)
    throw new ValidationError('Please check the highlighted fields.', {
      amount: 'Choose days or enter an amount, not both',
    });
  const cn = await db.transaction(async (tx) => {
    const inv = await lockIssued(tx, id);
    let lines: { id: string; amountPence: number }[] = [];
    if (lineIds.length) {
      lines = await tx
        .select({ id: invoiceLines.id, amountPence: invoiceLines.amountPence, credited: creditNoteLines.invoiceLineId })
        .from(invoiceLines)
        .leftJoin(creditNoteLines, eq(creditNoteLines.invoiceLineId, invoiceLines.id))
        .where(and(eq(invoiceLines.invoiceId, id), inArray(invoiceLines.id, lineIds)))
        .then((rows) => {
          if (rows.length !== lineIds.length) throw new NotFoundError('Line');
          if (rows.some((r) => r.credited)) throw new ConflictError('One of those days has already been credited.');
          return rows.filter((r) => r.amountPence > 0);
        });
      // A credited line settles any refund request for the same day.
      await tx
        .update(refundRequests)
        .set({
          status: 'declined',
          declineReason: 'Credited by the Owner',
          decidedAt: now,
          decidedBy: actor.kind === 'user' ? actor.userId : null,
        })
        .where(and(inArray(refundRequests.invoiceLineId, lineIds), eq(refundRequests.status, 'requested')));
    }
    const amount = d.amount ?? lines.reduce((a, l) => a + l.amountPence, 0);
    return createCreditNoteTx(tx, actor, inv, { lines, amountPence: amount, reason: d.reason }, now);
  });
  await submitPendingRefunds(db);
  return cn;
}

export const MarkRefundedInput = z.object({ reason: requiredText('how the money was returned', 300) });

/** Owner confirms money owed back on a credit note has been returned (card refunds automate this in Phase 6). */
export async function markCreditRefunded(db: Db, actor: Actor, rawId: string, input: unknown) {
  assertAuthorized(actor, 'refunds.manage');
  const d = parseInput(MarkRefundedInput, input);
  const id = idOrNotFound(rawId, 'Credit note');
  await db.transaction(async (tx) => {
    const [cn] = await tx.select().from(creditNotes).where(eq(creditNotes.id, id)).for('update');
    if (!cn) throw new NotFoundError('Credit note');
    if (cn.refundState !== 'awaiting_refund')
      throw new ConflictError('Nothing is waiting to be refunded on this credit note.');
    await tx.update(creditNotes).set({ refundState: 'refunded' }).where(eq(creditNotes.id, id));
    await recordAudit(tx, {
      actor,
      action: 'refund.marked_refunded',
      entityType: 'credit_note',
      entityId: id,
      metadata: { amountPence: cn.refundDuePence, method: 'manual', reasonGiven: d.reason.length > 0 },
    });
  });
}

// ---- Refund requests (D18, D54) ------------------------------------------------------

/**
 * Raise refund requests for member days on sent invoices that were cancelled free of charge
 * (48 h+ ahead, or by the Owner without a charge). Idempotent: one request per day.
 */
export async function raiseRefundRequests(q: Q, scope: { bookingDogIds?: string[]; invoiceId?: string } = {}) {
  if (scope.bookingDogIds && !scope.bookingDogIds.length) return 0;
  const rows = await q
    .select({
      customerId: bookingDogs.customerId,
      invoiceId: invoiceLines.invoiceId,
      invoiceLineId: invoiceLines.id,
      bookingDogId: bookingDogs.id,
      amountPence: invoiceLines.amountPence,
    })
    .from(bookingDogs)
    .innerJoin(invoiceLines, eq(invoiceLines.bookingDogId, bookingDogs.id))
    .innerJoin(invoices, eq(invoices.id, invoiceLines.invoiceId))
    .leftJoin(creditNoteLines, eq(creditNoteLines.invoiceLineId, invoiceLines.id))
    .where(
      and(
        eq(bookingDogs.status, 'cancelled'),
        eq(bookingDogs.lateCancellation, false),
        inArray(invoices.status, ['issued', 'paid']),
        eq(invoices.kind, 'membership'),
        isNull(creditNoteLines.invoiceLineId),
        scope.bookingDogIds ? inArray(bookingDogs.id, scope.bookingDogIds) : undefined,
        scope.invoiceId ? eq(invoices.id, scope.invoiceId) : undefined,
      ),
    );
  if (!rows.length) return 0;
  const inserted = await q
    .insert(refundRequests)
    .values(rows)
    .onConflictDoNothing({ target: refundRequests.bookingDogId })
    .returning({ id: refundRequests.id });
  for (const r of inserted)
    await recordAudit(q, {
      actor: { kind: 'system', job: 'refunds' },
      action: 'refund.requested',
      entityType: 'refund_request',
      entityId: r.id,
    });
  return inserted.length;
}

export async function ownerRefundRequests(db: Db, actor: Actor) {
  assertAuthorized(actor, 'refunds.manage');
  const rows = await db
    .select({
      r: refundRequests,
      number: invoices.number,
      customerName: users.name,
      dogName: dogs.name,
      serviceDate: bookingDogs.serviceDate,
      session: bookingDogs.session,
    })
    .from(refundRequests)
    .innerJoin(invoices, eq(invoices.id, refundRequests.invoiceId))
    .innerJoin(customers, eq(customers.id, refundRequests.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .innerJoin(bookingDogs, eq(bookingDogs.id, refundRequests.bookingDogId))
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .orderBy(desc(refundRequests.createdAt))
    .limit(200);
  const awaiting = await db
    .select({ cn: creditNotes, invoiceId: invoices.id, number: invoices.number, customerName: users.name })
    .from(creditNotes)
    .innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(creditNotes.refundState, 'awaiting_refund'))
    .orderBy(asc(creditNotes.createdAt));
  return {
    open: rows.filter((r) => r.r.status === 'requested'),
    decided: rows.filter((r) => r.r.status !== 'requested').slice(0, 50),
    awaiting,
  };
}

export const RefundDecisionInput = z.object({ reason: z.string().trim().max(300).optional() });

export async function decideRefund(
  db: Db,
  actor: Actor,
  rawId: string,
  approve: boolean,
  input: unknown,
  now = new Date(),
) {
  assertAuthorized(actor, 'refunds.manage');
  const d = parseInput(RefundDecisionInput, input);
  if (!approve && !d.reason)
    throw new ValidationError('Please check the highlighted fields.', {
      reason: 'Enter a reason the customer will see',
    });
  const id = idOrNotFound(rawId, 'Refund request');
  const by = actor.kind === 'user' ? actor.userId : null;
  const out = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(refundRequests).where(eq(refundRequests.id, id)).for('update');
    if (!r) throw new NotFoundError('Refund request');
    if (r.status !== 'requested') throw new ConflictError('This refund request has already been decided.');
    const [day] = await tx
      .select({ date: bookingDogs.serviceDate, dogName: dogs.name })
      .from(bookingDogs)
      .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
      .where(eq(bookingDogs.id, r.bookingDogId));
    const dayText = `${day?.dogName ?? 'your dog'} on ${day ? formatUkDate(day.date) : 'that day'}`;
    if (approve) {
      const inv = await lockIssued(tx, r.invoiceId);
      const cn = await createCreditNoteTx(
        tx,
        actor,
        inv,
        {
          lines: r.amountPence > 0 ? [{ id: r.invoiceLineId, amountPence: r.amountPence }] : [],
          amountPence: r.amountPence,
          reason: `Refund: ${dayText} cancelled 48 hours or more ahead`,
        },
        now,
      );
      await tx
        .update(refundRequests)
        .set({ status: 'approved', creditNoteId: cn.id, decidedBy: by, decidedAt: now })
        .where(eq(refundRequests.id, id));
    } else {
      await tx
        .update(refundRequests)
        .set({ status: 'declined', declineReason: d.reason!, decidedBy: by, decidedAt: now })
        .where(eq(refundRequests.id, id));
    }
    await recordAudit(tx, {
      actor,
      action: approve ? 'refund.approved' : 'refund.declined',
      entityType: 'refund_request',
      entityId: id,
      metadata: { amountPence: r.amountPence },
    });
    return { customerId: r.customerId, dayText, amountPence: r.amountPence };
  });
  if (approve) await submitPendingRefunds(db);
  const who = await customerContact(db, out.customerId);
  if (who)
    await sendSafely(
      refundDecisionMessage(
        who.email,
        firstNameOf(who.name),
        { approved: approve, dayText: out.dayText, amountText: pounds(out.amountPence), reason: d.reason },
        appUrl('/account/invoices'),
      ),
    );
}

// ---- Reading invoices ------------------------------------------------------------------

export type InvoiceFilter = 'draft' | 'scheduled' | 'unpaid' | 'overdue' | 'paid' | 'all';

export async function ownerInvoices(db: Db, actor: Actor, filter: InvoiceFilter = 'all', now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  const today = londonDate(now);
  const statusIn =
    filter === 'draft'
      ? ['draft']
      : filter === 'scheduled'
        ? ['scheduled']
        : filter === 'unpaid' || filter === 'overdue'
          ? ['issued']
          : filter === 'paid'
            ? ['paid', 'void']
            : ['draft', 'scheduled', 'issued', 'paid', 'void'];
  const rows = await db
    .select({
      inv: invoices,
      customerName: users.name,
      lineCount: sql<number>`(select count(*)::int from invoice_lines l where l.invoice_id = ${invoices.id})`,
    })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(inArray(invoices.status, statusIn as never[]))
    .orderBy(desc(invoices.periodMonth), asc(users.name), asc(invoices.createdAt))
    .limit(500);
  const bals = await balances(
    db,
    rows.map((r) => r.inv.id),
  );
  return rows
    .map((r) => {
      const bal = bals.get(r.inv.id)!;
      return { ...r, bal, state: paymentState(r.inv, bal, today) };
    })
    .filter((r) => (filter === 'overdue' ? r.state === 'overdue' : true));
}

export async function billingOverview(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  const [all, bs, refunds] = await Promise.all([
    ownerInvoices(db, actor, 'all', now),
    loadBusinessSettings(db),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(refundRequests)
      .where(eq(refundRequests.status, 'requested')),
  ]);
  const count = (s: string) => all.filter((r) => r.state === s).length;
  return {
    drafts: count('draft'),
    scheduled: count('scheduled'),
    overdue: count('overdue'),
    unpaid: count('unpaid') + count('part_paid'),
    duePence: all.reduce((a, r) => a + (['unpaid', 'part_paid', 'overdue'].includes(r.state) ? r.bal.duePence : 0), 0),
    refundRequests: refunds[0]?.n ?? 0,
    missingDetails: missingBusinessDetails(bs),
    months: billingMonths(londonDate(now), bs),
    schedule: bs,
  };
}

async function loadDetail(db: Db, id: string, now: Date) {
  const [row] = await db
    .select({ inv: invoices, customerName: users.name, customerEmail: users.email, customerUserId: users.id })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(invoices.id, id));
  if (!row) throw new NotFoundError('Invoice');
  const [lines, cns, cnLines, pays, refunds, bal] = await Promise.all([
    db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position)),
    db.select().from(creditNotes).where(eq(creditNotes.invoiceId, id)).orderBy(asc(creditNotes.createdAt)),
    db
      .select({ creditNoteId: creditNoteLines.creditNoteId, invoiceLineId: creditNoteLines.invoiceLineId })
      .from(creditNoteLines)
      .innerJoin(creditNotes, eq(creditNotes.id, creditNoteLines.creditNoteId))
      .where(eq(creditNotes.invoiceId, id)),
    db.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.createdAt)),
    db.select().from(refundRequests).where(eq(refundRequests.invoiceId, id)),
    balances(db, [id]).then((m) => m.get(id)!),
  ]);
  const creditedLine = new Map(
    cnLines.map((c) => [c.invoiceLineId, cns.find((n) => n.id === c.creditNoteId)?.number ?? '']),
  );
  return {
    ...row,
    lines: lines.map((l) => ({
      ...l,
      creditedBy: creditedLine.get(l.id) ?? null,
      refund: refunds.find((r) => r.invoiceLineId === l.id) ?? null,
    })),
    creditNotes: cns,
    payments: pays,
    refunds,
    bal,
    state: paymentState(row.inv, bal, londonDate(now)),
    seller: row.inv.sellerDetails ?? sellerSnapshot(await loadBusinessSettings(db)),
  };
}

export type InvoiceDetail = Awaited<ReturnType<typeof loadDetail>>;

export async function ownerInvoice(db: Db, actor: Actor, rawId: string, now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  return loadDetail(db, idOrNotFound(rawId, 'Invoice'), now);
}

/** A customer's own sent invoices. Drafts and approved-but-unsent invoices are never shown. */
export async function myInvoices(db: Db, actor: Actor, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'invoices.self.read', { ownerUserId: customer.userId });
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.customerId, customer.id), inArray(invoices.status, ['issued', 'paid', 'void'])))
    .orderBy(desc(invoices.issuedAt));
  const bals = await balances(
    db,
    rows.map((r) => r.id),
  );
  const today = londonDate(now);
  return rows.map((inv) => ({ inv, bal: bals.get(inv.id)!, state: paymentState(inv, bals.get(inv.id)!, today) }));
}

export async function myInvoice(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const me = asUser(actor);
  const id = idOrNotFound(rawId, 'Invoice');
  const detail = await loadDetail(db, id, now).catch(() => null);
  // Not found and not yours look the same (never reveal which).
  if (!detail || !detail.inv.number || detail.customerUserId !== me.userId) throw new NotFoundError('Invoice');
  assertAuthorized(me, 'invoices.self.read', { ownerUserId: detail.customerUserId });
  return detail;
}

/** Owner or the invoice's customer; used by the PDF route. */
export async function invoiceForDocument(db: Db, actor: Actor, rawId: string, now = new Date()) {
  if (hasPermission(actor, 'invoices.manage')) {
    const d = await ownerInvoice(db, actor, rawId, now);
    if (!d.inv.number) throw new NotFoundError('Invoice');
    return d;
  }
  return myInvoice(db, actor, rawId, now);
}

/** CSV of invoices for one month (D15). Totals in pounds with two decimals. */
export async function invoicesCsv(db: Db, actor: Actor, month: Month) {
  assertAuthorized(actor, 'exports.read');
  assertAuthorized(actor, 'invoices.manage');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !isIsoDate(`${month}-01`)) throw new NotFoundError('Month');
  const rows = await db
    .select({ inv: invoices, customerName: users.name })
    .from(invoices)
    .innerJoin(customers, eq(customers.id, invoices.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(eq(invoices.periodMonth, month), inArray(invoices.status, ['issued', 'paid', 'void'])))
    .orderBy(asc(invoices.number));
  const bals = await balances(
    db,
    rows.map((r) => r.inv.id),
  );
  const money = (p: number) => (p / 100).toFixed(2);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const out = [
    [
      'Invoice number',
      'Issue date',
      'Due date',
      'Customer',
      'Month',
      'Total',
      'Credited',
      'Paid',
      'Still owed',
      'Status',
    ].join(','),
  ];
  const today = londonDate(new Date());
  for (const r of rows) {
    const b = bals.get(r.inv.id)!;
    out.push(
      [
        r.inv.number ?? '',
        r.inv.issueDate ?? '',
        r.inv.dueDate ?? '',
        esc(r.customerName),
        month,
        money(b.totalPence),
        money(b.creditedPence),
        money(b.paidPence),
        money(b.duePence),
        paymentState(r.inv, b, today),
      ].join(','),
    );
  }
  await recordAudit(db, {
    actor,
    action: 'export.invoices',
    entityType: 'invoice',
    metadata: { month, rows: rows.length },
  });
  return out.join('\n') + '\n';
}

/** Tell the Owner new month drafts are ready (called by the jobs runner once a month). */
export async function notifyOwnerDraftsReady(db: Db, month: Month, count: number) {
  if (!count) return;
  for (const to of await ownerEmails(db))
    await sendSafely(
      ownerBillingMessage(
        to,
        `${count} invoice draft${count === 1 ? '' : 's'} for ${formatMonth(month)} ready`,
        `Membership invoices for ${formatMonth(month)} are ready for you to check. Approved invoices are sent automatically on the send day.`,
        appUrl('/admin/invoices?filter=draft'),
      ),
    );
}
