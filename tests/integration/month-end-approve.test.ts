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
const M1 = addMonths(monthOf(today), 1);
/** After next month's draft day, before its send day. */
const on26 = londonInstant(`${monthOf(today)}-26`, '10:00');
const now = new Date(Math.max(on26.getTime(), Date.now()));

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
async function mine() {
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
    return list.filter((d) => keep.has(d.id) && d.month === M1);
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
    const { first, last } = monthRange(M1);
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
    const input = { drafts: [...r.ready.map(seen), ...r.toCheck.map(seen)] };
    // Cat's draft is rebuilt after the Owner opened the page (its version moves on).
    await refreshMembershipDrafts(db(), owner, { customerId: customerIds.cat! }, now);
    mail.sent.length = 0;
    const out = await approveUnchangedDrafts(db(), owner, input, now);
    const ann = r.ready.filter((d) => d.customerName === 'ME ann');
    expect(out.approved).toBe(ann.length);
    expect(out.approvedPence).toBe(ann.reduce((a, d) => a + d.totalPence, 0));
    expect(out.notApproved.map((n) => n.customerName).sort()).toEqual(
      [...r.toCheck.map(nameOf), ...r.ready.filter((d) => d.customerName === 'ME cat').map(nameOf)].sort(),
    );

    const rows = await db()
      .select({ customerId: invoices.customerId, status: invoices.status, month: invoices.periodMonth })
      .from(invoices)
      .where(inArray(invoices.customerId, Object.values(customerIds)));
    for (const row of rows.filter((x) => x.month === M1)) {
      if (row.customerId === customerIds.ann) expect(row.status).not.toBe('draft');
      else expect(row.status).toBe('draft');
    }
    const nextMonth = rows.find((x) => x.customerId === customerIds.ann && x.month === M1);
    expect(nextMonth?.status).toBe('scheduled');
    // No email beyond what approving already sends (current-month invoices go straight away).
    expect(mail.sent.length).toBe(out.sentNow);

    const again = await approveUnchangedDrafts(db(), owner, input, now);
    expect(again.approved).toBe(0);
    expect(again.alreadyApproved).toBe(ann.length);
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
