import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { bookingDogs, customers, memberships, priceBooks, priceSnapshots } from '@/infra/db/schema';
import { createMyBookings, previewMyBookings } from '@/server/services/bookings';
import { ownerCreateBooking } from '@/server/services/owner-bookings';
import {
  addCustomerRate,
  endCustomerRate,
  listPriceBooks,
  removeScheduledPriceBook,
  schedulePriceBook,
} from '@/server/services/pricing';
import {
  approveMembership,
  declineMembership,
  leaveMembership,
  materialiseMemberships,
  myMemberships,
  ownerEndMembership,
  requestMembership,
  withdrawMembershipRequest,
} from '@/server/services/memberships';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { AuthorizationError } from '@/server/policy/authorize';
import { isoWeekday } from '@/domain/booking/rules';
import { changeEffectiveDate } from '@/domain/membership/rules';
import { addDays, londonDate } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer, releaseMemberDays } from '../support/onboard';

const db = () => getDb();
const today = londonDate(new Date());
const used = new Set<string>();
function weekdayAhead(n: number): string {
  let d = addDays(today, n);
  while (isoWeekday(d) > 5 || ['2026-12-25', '2026-12-28', '2027-01-01'].includes(d) || used.has(d)) d = addDays(d, 1);
  used.add(d);
  return d;
}
const nextMonday = () => {
  let d = addDays(today, 1);
  while (isoWeekday(d) !== 1) d = addDays(d, 1);
  return d;
};

let owner: TestUser;
let cara: TestUser;
let dan: TestUser;
let caraDog: string;
let caraDog2: string;
let danDog: string;
const mail = new MemoryEmailProvider();

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Olivia Owner');
  cara = await makeUser(db(), 'customer', 'Cara Member');
  dan = await makeUser(db(), 'customer', 'Dan Adhoc');
  await readyCustomer(db(), cara);
  await readyCustomer(db(), dan);
  caraDog = await approvedDog(db(), owner, cara, 'Maple');
  caraDog2 = await approvedDog(db(), owner, cara, 'Willow');
  danDog = await approvedDog(db(), owner, dan, 'Scout');
});
afterAll(async () => {
  await releaseMemberDays(db());
  setEmailProvider(undefined);
  await closeDb();
});

const snapshotFor = async (bookingDogId: string) =>
  (await db().select().from(priceSnapshots).where(eq(priceSnapshots.bookingDogId, bookingDogId)))[0];

describe('prices on bookings', () => {
  it('ad hoc bookings are priced at £50 full day and £25 half day, and the price is stored', async () => {
    const d1 = weekdayAhead(3);
    const d2 = weekdayAhead(3);
    const preview = await previewMyBookings(db(), dan, { dogIds: [danDog], dates: [d1], session: 'full', taxi: true });
    expect(preview.totalPence).toBe(5000);
    expect(preview.lines[0]!.price!.explanation).toBe('Ad hoc rate, full day: £50.00; dog taxi included');
    const r = await createMyBookings(db(), dan, { dogIds: [danDog], dates: [d1], session: 'full', taxi: true });
    expect(r.totalPence).toBe(5000);
    const h = await createMyBookings(db(), dan, { dogIds: [danDog], dates: [d2], session: 'am', taxi: false });
    expect(h.totalPence).toBe(2500);
    const rows = await db().select().from(bookingDogs).where(eq(bookingDogs.dogId, danDog));
    for (const row of rows) expect(await snapshotFor(row.id)).toBeTruthy();
  });

  it('snapshots can’t be changed or deleted', async () => {
    const [row] = await db().select().from(priceSnapshots).limit(1);
    await expect(
      db().update(priceSnapshots).set({ totalPence: 1 }).where(eq(priceSnapshots.id, row!.id)),
    ).rejects.toThrow();
    await expect(db().delete(priceSnapshots).where(eq(priceSnapshots.id, row!.id))).rejects.toThrow();
  });

  it('trial days use the band the Owner picks (D21)', async () => {
    const date = weekdayAhead(4);
    const id = await ownerCreateBooking(db(), owner, {
      dogId: danDog,
      date,
      session: 'full',
      trial: 'on',
      trialBand: 'high',
    });
    expect(await snapshotFor(id)).toMatchObject({ totalPence: 4500, rateCode: 'trial_member_high_full' });
    const [row] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, id));
    expect(row!.kind).toBe('trial');
  });
});

describe('scheduled price changes (D44, D45)', () => {
  it('new prices apply from their start date; existing bookings keep their price', async () => {
    const bookedBefore = await db().select().from(bookingDogs).where(eq(bookingDogs.dogId, danDog));
    const before = await Promise.all(bookedBefore.map((b) => snapshotFor(b.id)));
    const from = addDays(today, 30);
    await expect(
      schedulePriceBook(db(), owner, {
        name: 'Now',
        effectiveFrom: today,
        adHocFull: '55',
        memberLowFull: '52',
        memberHighFull: '49',
        halfDayPercent: '50',
        taxi: '0',
        multiDogDiscountPercent: '0',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await schedulePriceBook(db(), owner, {
      name: 'Later',
      effectiveFrom: from,
      adHocFull: '£55',
      memberLowFull: '52',
      memberHighFull: '49.50',
      halfDayPercent: '50',
      taxi: '0',
      multiDogDiscountPercent: '0',
    });
    const books = await listPriceBooks(db(), owner);
    expect(books[0]).toMatchObject({
      effectiveFrom: from,
      effectiveTo: null,
      adHocFullPence: 5500,
      memberHighFullPence: 4950,
    });
    expect(books[1]!.effectiveTo).toBe(addDays(from, -1));
    const after = await Promise.all(bookedBefore.map((b) => snapshotFor(b.id)));
    expect(after).toEqual(before);

    const later = weekdayAhead(31);
    const p = await previewMyBookings(db(), dan, { dogIds: [danDog], dates: [later], session: 'full', taxi: false });
    expect(p.totalPence).toBe(5500);
    const soon = weekdayAhead(5);
    expect(
      (await previewMyBookings(db(), dan, { dogIds: [danDog], dates: [soon], session: 'full', taxi: false }))
        .totalPence,
    ).toBe(5000);
  });

  it('overlapping price books are impossible at database level', async () => {
    await expect(
      db().insert(priceBooks).values({
        name: 'Overlap',
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-06-30',
        adHocFullPence: 1,
        memberLowFullPence: 1,
        memberHighFullPence: 1,
      }),
    ).rejects.toThrow();
  });

  it('a scheduled book can be removed before it starts, reopening the previous one', async () => {
    const [latest] = await listPriceBooks(db(), owner);
    await removeScheduledPriceBook(db(), owner, latest!.id);
    const books = await listPriceBooks(db(), owner);
    expect(books[0]!.effectiveTo).toBeNull();
    expect(books.find((b) => b.id === latest!.id)).toBeUndefined();
  });

  it('customers can’t change prices', async () => {
    await expect(listPriceBooks(db(), dan)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('customer-specific rates', () => {
  it('overrides the standard price from its start date and can be ended', async () => {
    const [c] = await db().select().from(customers).where(eq(customers.userId, dan.userId));
    await expect(
      addCustomerRate(db(), dan, c!.id, { fullDay: '30', startsOn: today, reason: 'x' }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await addCustomerRate(db(), owner, c!.id, { fullDay: '40', startsOn: today, reason: 'Loyal customer' });
    const date = weekdayAhead(6);
    const p = await previewMyBookings(db(), dan, { dogIds: [danDog], dates: [date], session: 'full', taxi: false });
    expect(p.lines[0]!.price).toMatchObject({ totalPence: 4000, rateCode: 'custom_full' });
    expect(p.lines[0]!.price!.explanation).toContain('Loyal customer');
    const rate = (await db().execute<{ id: string }>(sql`select id from customer_rates where customer_id = ${c!.id}`))
      .rows[0]!;
    await endCustomerRate(db(), owner, rate.id);
    const tomorrowish = weekdayAhead(7);
    expect(
      (await previewMyBookings(db(), dan, { dogIds: [danDog], dates: [tomorrowish], session: 'full', taxi: false }))
        .totalPence,
    ).toBe(5000);
  });
});

describe('memberships', () => {
  let membershipId: string;

  it('customer requests a membership; weekends and past dates are refused', async () => {
    await expect(
      requestMembership(db(), cara, { dogId: caraDog, weekdays: [6], session: 'full', startsOn: nextMonday() }),
    ).rejects.toMatchObject({ fields: { weekdays: expect.stringMatching(/not open/) } });
    await expect(
      requestMembership(db(), cara, { dogId: caraDog, weekdays: [1], session: 'full', startsOn: today }),
    ).rejects.toMatchObject({ fields: { startsOn: expect.any(String) } });
    await expect(
      requestMembership(db(), cara, { dogId: danDog, weekdays: [1], session: 'full', startsOn: nextMonday() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const r = await requestMembership(db(), cara, {
      dogId: caraDog,
      weekdays: [1, 2, 3, 4],
      session: 'full',
      taxi: 'on',
      startsOn: nextMonday(),
    });
    membershipId = r.id;
    await expect(
      requestMembership(db(), cara, { dogId: caraDog, weekdays: [5], session: 'full', startsOn: nextMonday() }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mail.sent.some((m) => m.template === 'owner.membership-request')).toBe(true);
    const mine = await myMemberships(db(), cara);
    expect(mine.memberships[0]).toMatchObject({ status: 'requested', band: 'high', dayPrice: 4500 });
  });

  it('Owner approval books the days ahead at the member rate, skipping closures', async () => {
    const [m] = await db().select().from(memberships).where(eq(memberships.id, membershipId));
    await expect(approveMembership(db(), cara, membershipId, { version: m!.version })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    const result = await approveMembership(db(), owner, membershipId, { version: m!.version });
    expect(result.booked).toBeGreaterThan(20);
    const rows = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.membershipId, membershipId), eq(bookingDogs.status, 'confirmed')));
    expect(
      rows.every((r) => r.kind === 'membership' && r.taxi && [1, 2, 3, 4].includes(isoWeekday(r.serviceDate))),
    ).toBe(true);
    const snap = await snapshotFor(rows[0]!.id);
    expect(snap).toMatchObject({ totalPence: 4500, rateCode: 'member_high_full' });
    expect(rows.some((r) => ['2026-12-25', '2026-12-28'].includes(r.serviceDate))).toBe(false);
    expect(mail.sent.some((x) => x.template === 'membership.approved')).toBe(true);
  });

  it('booking ahead again is idempotent', async () => {
    const before = await db().select().from(bookingDogs).where(eq(bookingDogs.membershipId, membershipId));
    const again = await materialiseMemberships(db(), owner, { membershipId });
    expect(again.booked).toBe(0);
    const after = await db().select().from(bookingDogs).where(eq(bookingDogs.membershipId, membershipId));
    expect(after.length).toBe(before.length);
  });

  it('members’ extra days are priced at their member rate (D17)', async () => {
    // A Friday after the membership has started (it starts next Monday).
    let fri = addDays(nextMonday(), 4);
    while (isoWeekday(fri) !== 5) fri = addDays(fri, 1);
    const p = await previewMyBookings(db(), cara, { dogIds: [caraDog], dates: [fri], session: 'full', taxi: false });
    expect(p.lines[0]!.price).toMatchObject({ totalPence: 4500, rateCode: 'member_high_full' });
    const other = await previewMyBookings(db(), cara, {
      dogIds: [caraDog2],
      dates: [fri],
      session: 'full',
      taxi: false,
    });
    expect(other.lines[0]!.price!.rateCode).toBe('ad_hoc_full');
  });

  it('full days are waitlisted and reported instead of overbooking', async () => {
    const r = await requestMembership(db(), cara, {
      dogId: caraDog2,
      weekdays: [5],
      session: 'full',
      startsOn: nextMonday(),
    });
    let fri = nextMonday();
    while (isoWeekday(fri) !== 5) fri = addDays(fri, 1);
    await db().execute(
      sql`insert into service_days (service_date, session_capacity) values (${fri}, 0) on conflict (service_date) do update set session_capacity = 0`,
    );
    const [m] = await db().select().from(memberships).where(eq(memberships.id, r.id));
    const res = await approveMembership(db(), owner, r.id, { version: m!.version });
    expect(res.waitlisted).toBeGreaterThanOrEqual(1);
    expect(res.clashes.some((c) => c.date === fri && /waitlisted/.test(c.reason))).toBe(true);
    const [row] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.membershipId, r.id), eq(bookingDogs.serviceDate, fri)));
    expect(row!.status).toBe('waitlisted');
  });

  it('a change of days starts on the next allowed 1st and replaces the old days after that', async () => {
    const [current] = await db().select().from(memberships).where(eq(memberships.id, membershipId));
    const change = await requestMembership(
      db(),
      cara,
      { dogId: caraDog, weekdays: [1, 2], session: 'full', startsOn: today },
      { changeOf: membershipId },
    );
    const effective = changeEffectiveDate(today);
    expect(change.startsOn).toBe(effective);
    const [m] = await db().select().from(memberships).where(eq(memberships.id, change.id));
    await approveMembership(db(), owner, change.id, { version: m!.version });
    const [old] = await db().select().from(memberships).where(eq(memberships.id, membershipId));
    expect(old!.endsOn).toBe(addDays(effective, -1));
    const oldAfter = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.membershipId, membershipId), sql`${bookingDogs.serviceDate} >= ${effective}`));
    expect(oldAfter.every((r) => r.status === 'cancelled' && r.lateCancellation === false)).toBe(true);
    const newDays = await db().select().from(bookingDogs).where(eq(bookingDogs.membershipId, change.id));
    expect(newDays.every((r) => r.serviceDate >= effective && [1, 2].includes(isoWeekday(r.serviceDate)))).toBe(true);
    if (newDays.length)
      expect(await snapshotFor(newDays[0]!.id)).toMatchObject({ totalPence: 4800, rateCode: 'member_low_full' });
    expect(current!.status).toBe('active');
  });

  it('leaving ends the membership before the next allowed 1st and frees later days', async () => {
    const [active] = await db()
      .select()
      .from(memberships)
      .where(and(eq(memberships.dogId, caraDog2), eq(memberships.status, 'active')));
    const { endsOn } = await leaveMembership(db(), cara, active!.id);
    expect(endsOn).toBe(
      addDays(changeEffectiveDate(today), -1) < active!.startsOn
        ? active!.startsOn
        : addDays(changeEffectiveDate(today), -1),
    );
    const later = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.membershipId, active!.id), sql`${bookingDogs.serviceDate} > ${endsOn}`));
    expect(later.every((r) => r.status === 'cancelled')).toBe(true);
    await expect(leaveMembership(db(), dan, active!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('Owner can decline with a reason, and customers can withdraw requests', async () => {
    const r = await requestMembership(db(), dan, {
      dogId: danDog,
      weekdays: [3],
      session: 'am',
      startsOn: nextMonday(),
    });
    const [m] = await db().select().from(memberships).where(eq(memberships.id, r.id));
    await expect(declineMembership(db(), owner, r.id, { version: m!.version })).rejects.toBeInstanceOf(ValidationError);
    await declineMembership(db(), owner, r.id, { version: m!.version, reason: 'Wednesdays are full' });
    const r2 = await requestMembership(db(), dan, {
      dogId: danDog,
      weekdays: [2],
      session: 'am',
      startsOn: nextMonday(),
    });
    await withdrawMembershipRequest(db(), dan, r2.id);
    const [w] = await db().select().from(memberships).where(eq(memberships.id, r2.id));
    expect(w!.status).toBe('withdrawn');
  });

  it('Owner can end a membership on a chosen day', async () => {
    const [active] = await db()
      .select()
      .from(memberships)
      .where(and(eq(memberships.dogId, caraDog), eq(memberships.status, 'active'), sql`${memberships.endsOn} is null`));
    const last = addDays(active!.startsOn, 7);
    await ownerEndMembership(db(), owner, active!.id, { version: active!.version, endsOn: last });
    const after = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.membershipId, active!.id), sql`${bookingDogs.serviceDate} > ${last}`));
    expect(after.every((r) => r.status === 'cancelled')).toBe(true);
  });
});
