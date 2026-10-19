import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { setPaymentProvider } from '@/infra/payments';
import { SimulatedPaymentProvider } from '@/infra/payments/simulated';
import { checkoutAttempts, customers, invoices, users } from '@/infra/db/schema';
import { completeCheckout } from '@/server/services/payments';
import { invoicesCsv } from '@/server/services/billing';

import { weekdayPicker } from '../support/dates';
import { requestAndApprove } from '../support/requests';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer } from '../support/onboard';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const stripe = new SimulatedPaymentProvider('http://localhost:3000');
/** An open weekday well away from other test files' dates. */
const weekdayAhead = weekdayPicker({ unique: false });

const FORMULA = '=HYPERLINK("http://x","click")';
let owner: TestUser;
let eve: TestUser;
let dog: string;

beforeAll(async () => {
  setEmailProvider(mail);
  setPaymentProvider(stripe);
  owner = await makeUser(db(), 'owner', 'Ola Owner');
  eve = await makeUser(db(), 'customer', FORMULA);
  await readyCustomer(db(), eve);
  dog = await approvedDog(db(), owner, eve, 'Biscuit');
});
afterAll(async () => {
  setEmailProvider(undefined);
  setPaymentProvider(undefined);
  await closeDb();
});

describe('invoices CSV export (D35)', () => {
  it('neutralises formula cells and uses the name snapshotted on the invoice', async () => {
    const date = weekdayAhead(57);
    await requestAndApprove(db(), eve, { dogIds: [dog], dates: [date], session: 'full', taxi: false }, owner);
    const [attempt] = await db()
      .select({ a: checkoutAttempts })
      .from(checkoutAttempts)
      .innerJoin(customers, eq(customers.id, checkoutAttempts.customerId))
      .where(and(eq(customers.userId, eve.userId), eq(checkoutAttempts.status, 'open')))
      .then((r) => r.map((x) => x.a));
    expect(attempt).toBeDefined();
    stripe.pay(attempt!.providerSessionId!);
    await completeCheckout(db(), attempt!.id);
    const [paid] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, attempt!.id));
    const [inv] = await db().select().from(invoices).where(eq(invoices.id, paid!.resultInvoiceId!));
    expect(inv!.number).toBeTruthy();
    expect(inv!.billToName).toBe(FORMULA);

    // The customer later changes their name (or is anonymised): the export keeps the billed name.
    await db().update(users).set({ name: 'Eve Renamed' }).where(eq(users.id, eve.userId));

    const csv = await invoicesCsv(db(), owner, inv!.periodMonth);
    const row = csv.split(/\r?\n/).find((l) => l.startsWith(`${inv!.number},`));
    expect(row, 'the invoice should be in the export').toBeDefined();
    expect(row).toContain(`,"'=HYPERLINK(""http://x"",""click"")",`);
    expect(row).not.toContain('Eve Renamed');
  });
});
