import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { setPaymentProvider } from '@/infra/payments';
import { SimulatedPaymentProvider } from '@/infra/payments/simulated';
import { checkoutAttempts, dataRequests, invoiceLines, invoices } from '@/infra/db/schema';
import { issueCreditNote, issueTx, recordManualPayment } from '@/server/services/billing';
import { startInvoiceCheckout } from '@/server/services/payments';
import { requestErasure } from '@/server/services/privacy';
import { ConflictError } from '@/server/errors';
import { londonDate } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { readyCustomer } from '../support/onboard';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const stripe = new SimulatedPaymentProvider('http://localhost:3000');
const today = londonDate(new Date());
let owner: TestUser;

async function customerId(u: TestUser) {
  const [c] = (await db().execute<{ id: string }>(sql`select id from customers where user_id = ${u.userId}`)).rows;
  return c!.id;
}

/** A sent £96 invoice (two £48 days) with the customer's card checkout open on it. */
async function invoiceWithOpenCheckout(u: TestUser) {
  const [inv] = await db()
    .insert(invoices)
    .values({ customerId: await customerId(u), periodMonth: today.slice(0, 7), status: 'draft', totalPence: 9600 })
    .returning();
  const lines = await db()
    .insert(invoiceLines)
    .values([
      { invoiceId: inv!.id, position: 1, description: 'Fern – Full day', amountPence: 4800 },
      { invoiceId: inv!.id, position: 2, description: 'Fern – Full day', amountPence: 4800 },
    ])
    .returning();
  await db().update(invoices).set({ status: 'scheduled', scheduledFor: new Date() }).where(eq(invoices.id, inv!.id));
  await db().transaction((tx) => issueTx(tx, inv!.id, new Date(), { requireDetails: false }));
  await startInvoiceCheckout(db(), u, inv!.id);
  return { invoiceId: inv!.id, lineIds: lines.map((l) => l.id) };
}

const checkoutsOn = (invoiceId: string) =>
  db().select().from(checkoutAttempts).where(eq(checkoutAttempts.invoiceId, invoiceId));

beforeAll(async () => {
  setEmailProvider(mail);
  setPaymentProvider(stripe);
  owner = await makeUser(db(), 'owner', 'Orla Owner');
});
afterAll(async () => {
  setEmailProvider(undefined);
  setPaymentProvider(undefined);
  await closeDb();
});

describe('open card checkouts after the amount owed drops (review L2)', () => {
  it('a credit note for the whole invoice closes the open checkout', async () => {
    const u = await makeUser(db(), 'customer', 'Cara Credit');
    await readyCustomer(db(), u);
    const { invoiceId, lineIds } = await invoiceWithOpenCheckout(u);
    expect((await checkoutsOn(invoiceId)).map((a) => a.status)).toEqual(['open']);
    await issueCreditNote(db(), owner, invoiceId, { lineIds, reason: 'Closed for the week' });
    const [a] = await checkoutsOn(invoiceId);
    expect(a!.status).toBe('expired');
    await expect(stripe.getCheckout(a!.providerSessionId!)).resolves.toMatchObject({ paid: false });
  });

  it('a manual payment that leaves less owed than the checkout would take closes it', async () => {
    const u = await makeUser(db(), 'customer', 'Max Manual');
    await readyCustomer(db(), u);
    const { invoiceId } = await invoiceWithOpenCheckout(u);
    await recordManualPayment(db(), owner, invoiceId, { amount: '48.00', receivedOn: today, reason: 'Cash' });
    const [a] = await checkoutsOn(invoiceId);
    expect(a!.amountPence).toBe(9600);
    expect(a!.status).toBe('expired');
    // The customer can start a new checkout for what's left.
    await startInvoiceCheckout(db(), u, invoiceId);
    const open = (await checkoutsOn(invoiceId)).filter((x) => x.status === 'open');
    expect(open.map((x) => x.amountPence)).toEqual([4800]);
  });
});

describe('deletion requests (review L5)', () => {
  it('a double-submit stores one request and emails the Owner once', async () => {
    const u = await makeUser(db(), 'customer', 'Dee Double');
    await readyCustomer(db(), u);
    mail.sent.length = 0;
    // Open enough pooled connections first, so the requests really run side by side.
    await Promise.all(Array.from({ length: 8 }, () => db().execute(sql`select pg_sleep(0.05)`)));
    // Several taps at once (double-clicks, a retried request): all pass the "already asked?" check together.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => requestErasure(db(), u, { reason: 'Moving away' })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    const rows = await db()
      .select()
      .from(dataRequests)
      .where(eq(dataRequests.customerId, await customerId(u)));
    expect(rows).toHaveLength(1);
    const toOwner = mail.sent.filter(
      (m) => m.to === owner.email && m.subject.endsWith('A customer asked to delete their account'),
    );
    expect(toOwner).toHaveLength(1);
  });

  it('the database refuses a second open request for the same customer', async () => {
    const u = await makeUser(db(), 'customer', 'Ida Index');
    await readyCustomer(db(), u);
    const id = await customerId(u);
    await db().insert(dataRequests).values({ customerId: id });
    await expect(db().insert(dataRequests).values({ customerId: id })).rejects.toThrow();
    // Decided requests don't count: a customer can ask again after a decline.
    await db()
      .update(dataRequests)
      .set({ status: 'declined', decisionReason: 'Unpaid invoice' })
      .where(eq(dataRequests.customerId, id));
    await db().insert(dataRequests).values({ customerId: id });
  });

  it('migration 0019 (review_lows) keeps only the earliest open request when duplicates already exist', async () => {
    const u = await makeUser(db(), 'customer', 'Pre Existing');
    await readyCustomer(db(), u);
    const id = await customerId(u);
    const statements = readFileSync('drizzle/0019_review_lows.sql', 'utf8').split('--> statement-breakpoint');
    const dedupe = statements.find((s) => /DELETE FROM "data_requests"/.test(s))!;
    const kept = await db()
      .transaction(async (tx) => {
        await tx.execute(sql`drop index data_requests_one_open_uq`);
        await tx.insert(dataRequests).values([
          { customerId: id, requestedAt: new Date('2026-01-02T10:00:00Z'), customerReason: 'first' },
          { customerId: id, requestedAt: new Date('2026-01-02T10:00:01Z'), customerReason: 'second' },
          { customerId: id, requestedAt: new Date('2026-01-03T10:00:00Z'), customerReason: 'third' },
        ]);
        await tx.execute(sql.raw(dedupe));
        const create = statements.find((s) => /CREATE UNIQUE INDEX "data_requests_one_open_uq"/.test(s))!;
        await tx.execute(sql.raw(create)); // would fail if any duplicate survived
        const rows = await tx.select().from(dataRequests).where(eq(dataRequests.customerId, id));
        throw Object.assign(new Error('rollback'), { rows });
      })
      .catch((e: Error & { rows?: (typeof dataRequests.$inferSelect)[] }) => {
        if (!e.rows) throw e;
        return e.rows;
      });
    expect(kept.map((r) => r.customerReason)).toEqual(['first']);
  });
});

describe('indexes (review L6)', () => {
  it('booking_dogs.booking_id is indexed', async () => {
    const { rows } = await db().execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where tablename = 'booking_dogs' and indexname = 'booking_dogs_booking_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(/\(booking_id\)/);
  });
});
