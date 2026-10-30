import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { auditEvents, bookingDogs, customers, invoices } from '@/infra/db/schema';
import { ownerSetMembershipDays } from '@/server/services/membership-workflow';
import {
  approveUnchangedDrafts,
  monthEndDrafts,
  refreshMembershipDrafts,
  updateBusinessSettings,
  type MonthEndDraft,
} from '@/server/services/billing';
import { AuthorizationError } from '@/server/policy/authorize';
import { ValidationError } from '@/server/errors';
import { addMonths, monthOf, monthRange } from '@/domain/billing/rules';
import { addDays, londonDate, londonInstant } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer, clearDayLimits, releaseMemberDays } from '../support/onboard';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const today = londonDate(new Date());
// Pinned app clock, independent of the real date: the 26th of next month at 10:00 – after the
// draft day, before the send day (28th 09:00). CUR is then the current month (sent straight away,
// D55) and TARGET the month after (waits for the send day).
const CUR = addMonths(monthOf(today), 1);
const TARGET = addMonths(CUR, 1);
const now = londonInstant(`${CUR}-26`, '10:00');
const sendAt = londonInstant(`${CUR}-28`, '09:00');

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

let owner: TestUser;
const people: Record<'ann' | 'ben' | 'cat' | 'dan', TestUser> = {} as never;
const customerIds: Record<string, string> = {};

const seen = (d: MonthEndDraft) => `${d.id}:${d.version}:${d.totalPence}`;
async function mine(month: string = TARGET) {
  const r = await monthEndDrafts(db(), owner);
  const ids = new Set(Object.values(customerIds));
  const own = async (list: MonthEndDraft[]) => {
    const rows = list.length
      ? await db()
          .select({ id: invoices.id, customerId: invoices.customerId })
          .from(invoices)
          .where(
            inArray(
              invoices.id,
              list.map((d) => d.id),
            ),
          )
      : [];
    const keep = new Set(rows.filter((x) => ids.has(x.customerId)).map((x) => x.id));
    return list.filter((d) => keep.has(d.id) && d.month === month);
  };
  return { ready: await own(r.ready), toCheck: await own(r.toCheck) };
}
const nameOf = (d: MonthEndDraft) => d.customerName;

beforeAll(async () => {
  setEmailProvider(mail);
  await clearDayLimits(db());
  owner = await makeUser(db(), 'owner', 'Olive Owner');
  await updateBusinessSettings(db(), owner, BUSINESS);
  for (const n of ['ann', 'ben', 'cat', 'dan'] as const) {
    const u = await makeUser(db(), 'customer', `ME ${n}`);
    people[n] = u;
    await readyCustomer(db(), u);
    const dog = await approvedDog(db(), owner, u, `Dog ${n}`);
    await ownerSetMembershipDays(db(), owner, dog, { weekdays: [2, 4], session: 'full', startsOn: addDays(today, 1) });
    const [c] = await db().select({ id: customers.id }).from(customers).where(eq(customers.userId, u.userId));
    customerIds[n] = c!.id;
  }
  await refreshMembershipDrafts(db(), owner, {}, now);
});
afterAll(async () => {
  await releaseMemberDays(db());
  setEmailProvider(undefined);
  await closeDb();
});

describe('month-end in one tap (D95)', () => {
  it('lists drafts that changed or need attention separately, and leaves them out', async () => {
    // Ben: one of next month's days is cancelled free after the draft was made.
    const { first, last } = monthRange(TARGET);
    const [day] = await db()
      .select({ id: bookingDogs.id })
      .from(bookingDogs)
      .where(
        and(
          eq(bookingDogs.customerId, customerIds.ben!),
          eq(bookingDogs.status, 'confirmed'),
          gte(bookingDogs.serviceDate, first),
          lte(bookingDogs.serviceDate, last),
        ),
      )
      .orderBy(desc(bookingDogs.serviceDate));
    expect(day).toBeDefined();
    await db()
      .update(bookingDogs)
      .set({ status: 'cancelled', cancelledAt: new Date(), lateCancellation: false })
      .where(eq(bookingDogs.id, day!.id));
    // Dan: account closed.
    await db().update(customers).set({ anonymisedAt: new Date() }).where(eq(customers.id, customerIds.dan!));

    const r = await mine();
    expect(first < last).toBe(true);
    expect(r.ready.length).toBeGreaterThan(0);
    expect(new Set(r.ready.map(nameOf))).toEqual(new Set(['ME ann', 'ME cat']));
    const ben = r.toCheck.find((d) => d.customerName === 'ME ben');
    expect(ben?.reasons.join(' ')).toMatch(/changed since it was made/);
    expect(r.toCheck.find((d) => d.customerName === 'ME dan')?.reasons.join(' ')).toMatch(/closed/);
  });

  it('only the Owner can see or use it, and the input is checked', async () => {
    await expect(monthEndDrafts(db(), people.ann)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(approveUnchangedDrafts(db(), people.ann, { drafts: ['x'] })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(approveUnchangedDrafts(db(), owner, { drafts: ['not-a-draft'] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(approveUnchangedDrafts(db(), owner, { drafts: [] })).rejects.toBeInstanceOf(ValidationError);
  });

  it('approves the unchanged ones through the usual approval, refuses any that changed meanwhile, and is safe to repeat', async () => {
    const r = await mine();
    // Ann's current-month draft is in the same tap: it goes out straight away (D55).
    const annCur = (await mine(CUR)).ready.filter((d) => d.customerName === 'ME ann');
    expect(annCur.length).toBe(1);
    const input = { drafts: [...annCur.map(seen), ...r.ready.map(seen), ...r.toCheck.map(seen)] };
    // Cat's draft is rebuilt after the Owner opened the page (its version moves on).
    await refreshMembershipDrafts(db(), owner, { customerId: customerIds.cat! }, now);
    mail.sent.length = 0;
    const out = await approveUnchangedDrafts(db(), owner, input, now);
    const ann = r.ready.filter((d) => d.customerName === 'ME ann');
    expect(ann.length).toBe(1);
    expect(out.approved).toBe(2);
    expect(out.approvedPence).toBe(ann[0]!.totalPence + annCur[0]!.totalPence);
    expect(out.notApproved.map((n) => n.customerName).sort()).toEqual(
      [...r.toCheck.map(nameOf), ...r.ready.filter((d) => d.customerName === 'ME cat').map(nameOf)].sort(),
    );

    const rows = await db()
      .select({
        customerId: invoices.customerId,
        status: invoices.status,
        month: invoices.periodMonth,
        scheduledFor: invoices.scheduledFor,
      })
      .from(invoices)
      .where(inArray(invoices.customerId, Object.values(customerIds)));
    for (const row of rows.filter((x) => x.month === TARGET)) {
      if (row.customerId === customerIds.ann) expect(row.status).not.toBe('draft');
      else expect(row.status).toBe('draft');
    }
    // Next month's invoice waits for the send day; the current month's is issued now.
    const annTarget = rows.find((x) => x.customerId === customerIds.ann && x.month === TARGET);
    expect(annTarget?.status).toBe('scheduled');
    expect(annTarget?.scheduledFor?.toISOString()).toBe(sendAt.toISOString());
    expect(rows.find((x) => x.customerId === customerIds.ann && x.month === CUR)?.status).toBe('issued');
    // Exactly one email: the current-month invoice. Nothing for next month's until the send day.
    expect(out.sentNow).toBe(1);
    expect(mail.sent.length).toBe(1);
    expect(mail.sent[0]!.to).toBe(people.ann.email);

    const again = await approveUnchangedDrafts(db(), owner, input, now);
    expect(again.approved).toBe(0);
    expect(again.alreadyApproved).toBe(2);
    expect(mail.sent.length).toBe(1);
  });

  it('writes one audit entry with counts only', async () => {
    const [e] = await db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'invoice.bulk_approved'))
      .orderBy(desc(auditEvents.id))
      .limit(1);
    expect(e).toBeDefined();
    expect(Object.keys(e!.metadata).sort()).toEqual(
      ['alreadyApproved', 'approved', 'notApproved', 'sentNow', 'totalPence'].sort(),
    );
    expect(JSON.stringify(e!.metadata)).not.toMatch(/ME |@/);
  });
});
