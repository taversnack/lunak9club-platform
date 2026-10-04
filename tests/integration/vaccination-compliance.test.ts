/**
 * Vaccination compliance (D11, D40, D42, D66, D73–D75; licence guidance 9.4):
 * hard blocks for core (DHP) and leptospirosis at every booking path and at check-in, kennel cough
 * still overridable, the 14-day wait after a first course, and the 60/30/14/7 reminders.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { FsStorageProvider } from '@/infra/storage/fs';
import {
  auditEvents,
  bookingDogs,
  complianceRequirements,
  complianceSubmissions,
  memberships,
  notificationLog,
} from '@/infra/db/schema';
import { createMyDog, saveMyDogVet, submitMyOnboardingForm } from '@/server/services/dogs';
import { uploadVaccinationRecord } from '@/server/services/documents';
import { acceptOffer, createMyBookings, previewMyBookings } from '@/server/services/bookings';
import {
  addClosure,
  checkIn,
  ownerCreateBooking,
  offerPlace,
  ownerDay,
  removeClosure,
  setDayCapacity,
} from '@/server/services/owner-bookings';
import { approveMembership, requestMembership } from '@/server/services/memberships';
import { recordAssessment, reviewSubmission, updateRequirement } from '@/server/services/owner-review';
import { sendVaccinationReminders } from '@/server/services/reminders';
import { ConflictError, ValidationError } from '@/server/errors';
import { isoWeekday } from '@/domain/booking/rules';
import { addDays, londonDate, londonInstant } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { payOpenCheckouts } from '../support/payments';
import { makeUser, PDF, validDog, validOnboarding, type TestUser } from '../support/factories';
import { approvedDog, approveVaccinations, readyCustomer, releaseMemberDays } from '../support/onboard';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const storage = new FsStorageProvider(mkdtempSync(join(tmpdir(), 'lunak9-vacc-')));
const system = { kind: 'system', job: 'test' } as const;
const today = londonDate(new Date());
const HOLIDAYS = new Set(['2026-12-25', '2026-12-28', '2027-01-01']);
const used = new Set<string>();
function weekdayAhead(n: number): string {
  let d = addDays(today, n);
  while (isoWeekday(d) > 5 || HOLIDAYS.has(d) || used.has(d)) d = addDays(d, 1);
  used.add(d);
  return d;
}
function nextMonday(): string {
  let d = addDays(today, 1);
  while (isoWeekday(d) !== 1) d = addDays(d, 1);
  return d;
}

const CORE = 'vaccination_core';
const LEPTO = 'vaccination_leptospirosis';
const KC = 'vaccination_kennel_cough';
type BadState = 'missing' | 'pending_review' | 'rejected' | 'replacement_requested' | 'expired';
const BAD_STATES: [BadState, RegExp][] = [
  ['missing', /is missing/],
  ['pending_review', /waiting to be checked/],
  ['rejected', /wasn’t accepted/],
  ['replacement_requested', /new copy/],
  ['expired', /has expired/],
];

/** Put a dog's approved record for `key` into a given state (or back to approved and valid). */
async function setState(dogId: string, key: string, state: BadState | 'approved') {
  const where = and(
    eq(complianceSubmissions.dogId, dogId),
    eq(complianceSubmissions.requirementKey, key),
    inArray(complianceSubmissions.status, [
      'approved',
      'pending_review',
      'rejected',
      'replacement_requested',
      'superseded',
    ]),
  );
  const [sub] = await db()
    .select()
    .from(complianceSubmissions)
    .where(where)
    .orderBy(desc(complianceSubmissions.submittedAt))
    .limit(1);
  const id = sub!.id;
  const set = (v: Partial<typeof complianceSubmissions.$inferInsert>) =>
    db().update(complianceSubmissions).set(v).where(eq(complianceSubmissions.id, id));
  switch (state) {
    case 'approved':
      return set({ status: 'approved', reviewReason: null, expiresOn: addDays(today, 200) });
    case 'missing':
      return set({ status: 'superseded' });
    case 'pending_review':
      return set({ status: 'pending_review', reviewReason: null });
    case 'rejected':
    case 'replacement_requested':
      return set({ status: state, reviewReason: 'Please send a clearer copy' });
    case 'expired':
      return set({ status: 'approved', reviewReason: null, expiresOn: addDays(today, -1) });
  }
}

async function setPrimary(dogId: string, date: string | null) {
  await db()
    .update(complianceSubmissions)
    .set({ primaryCourseCompletedOn: date })
    .where(and(eq(complianceSubmissions.dogId, dogId), eq(complianceSubmissions.requirementKey, CORE)));
}

/** A dog that isn't approved yet, with vet, form and assessments done. */
async function unapprovedDog(user: TestUser, name: string) {
  const id = await createMyDog(db(), user, { ...validDog, name });
  await saveMyDogVet(db(), user, id, { practiceName: 'Vets', phone: '01483000000', agreedVet: 'same' });
  await submitMyOnboardingForm(db(), user, id, validOnboarding);
  await recordAssessment(db(), owner, id, { kind: 'meet_and_greet', outcome: 'passed', assessedOn: today });
  return id;
}

/** Book a dog for today as the Owner (today may be a weekend, so always give a reason) and pay. */
async function bookToday(dogId: string) {
  const id = await ownerCreateBooking(db(), owner, { dogId, date: today, session: 'full', overrideReason: 'Test day' });
  await payOpenCheckouts(db());
  const [bd] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, id));
  expect(bd!.status).toBe('confirmed');
  return bd!;
}
const fresh = async (id: string) => (await db().select().from(bookingDogs).where(eq(bookingDogs.id, id)))[0]!;

let owner: TestUser;
let cass: TestUser;
let dogA: string; // approved, used for state loops
let dogKc: string;
let dogPrimary: string;

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Vera Owner');
  cass = await makeUser(db(), 'customer', 'Cass Compliance');
  await readyCustomer(db(), cass);
  dogA = await approvedDog(db(), owner, cass, 'Acorn');
  dogKc = await approvedDog(db(), owner, cass, 'Kestrel');
  dogPrimary = await approvedDog(db(), owner, cass, 'Pebble');
});
afterAll(async () => {
  // Free every place this file took so later files see empty days.
  await payOpenCheckouts(db());
  await db().execute(
    sql`update booking_dogs set status = 'cancelled', cancelled_at = now(), late_cancellation = false
        where customer_id = (select id from customers where user_id = ${cass.userId})
          and status in ('confirmed', 'pending_payment', 'waitlisted', 'offered') and service_date > ${today}`,
  );
  await releaseMemberDays(db());
  setEmailProvider(undefined);
  await closeDb();
});

describe('Owner booking: core and leptospirosis can’t be overridden (D42, D73)', () => {
  const date = weekdayAhead(9);
  for (const key of [CORE, LEPTO]) {
    for (const [state, msg] of BAD_STATES) {
      it(`${key} ${state}: refused even with a reason and as a trial day`, async () => {
        await setState(dogA, key, state);
        try {
          for (const extra of [{}, { overrideReason: 'Owner says fine' }, { overrideReason: 'Trial', trial: 'on' }]) {
            const p = ownerCreateBooking(db(), owner, { dogId: dogA, date, session: 'full', ...extra });
            await expect(p).rejects.toBeInstanceOf(ValidationError);
            await expect(p).rejects.toMatchObject({ fields: { date: expect.stringMatching(msg) } });
          }
        } finally {
          await setState(dogA, key, 'approved');
        }
        const live = await db()
          .select()
          .from(bookingDogs)
          .where(and(eq(bookingDogs.dogId, dogA), eq(bookingDogs.serviceDate, date)));
        expect(live).toHaveLength(0);
      });
    }
  }

  it('a trial day for a dog that isn’t approved is still refused without leptospirosis', async () => {
    const pup = await unapprovedDog(cass, 'Trial Tilly');
    await approveVaccinations(db(), owner, cass, pup, [CORE, KC]);
    await expect(
      ownerCreateBooking(db(), owner, {
        dogId: pup,
        date: weekdayAhead(10),
        session: 'full',
        trial: 'on',
        overrideReason: 'Trial',
      }),
    ).rejects.toMatchObject({ fields: { date: expect.stringMatching(/Leptospirosis vaccination is missing/) } });
  });

  it('kennel cough can still be overridden with a reason, and that is audited without detail', async () => {
    await setState(dogKc, KC, 'expired');
    const date = weekdayAhead(81);
    await expect(ownerCreateBooking(db(), owner, { dogId: dogKc, date, session: 'full' })).rejects.toMatchObject({
      fields: { overrideReason: expect.stringMatching(/Kennel cough vaccination has expired/) },
    });
    const id = await ownerCreateBooking(db(), owner, {
      dogId: dogKc,
      date,
      session: 'full',
      overrideReason: 'Booster booked',
    });
    expect((await fresh(id)).overrideReason).toBe('Booster booked');
    const [audit] = await db().select().from(auditEvents).where(eq(auditEvents.entityId, id));
    expect(audit).toMatchObject({ action: 'booking.created_with_override', metadata: { by: 'owner', overrides: 1 } });
    expect(JSON.stringify(audit!.metadata)).not.toMatch(/kennel|vaccin/i);
    await setState(dogKc, KC, 'approved');
  });

  it('a reason still overrides closures, capacity and approval; trial days need none for approval', async () => {
    const closed = weekdayAhead(82);
    await addClosure(db(), owner, { date: closed, reason: 'Staff training' });
    await expect(ownerCreateBooking(db(), owner, { dogId: dogA, date: closed, session: 'full' })).rejects.toMatchObject(
      {
        fields: { overrideReason: expect.any(String) },
      },
    );
    await ownerCreateBooking(db(), owner, { dogId: dogA, date: closed, session: 'full', overrideReason: 'Agreed' });
    await removeClosure(db(), owner, closed);

    const full = weekdayAhead(83);
    await setDayCapacity(db(), owner, { date: full, sessionCapacity: 0, taxiCapacity: 20 });
    await expect(ownerCreateBooking(db(), owner, { dogId: dogA, date: full, session: 'full' })).rejects.toMatchObject({
      fields: { overrideReason: expect.stringMatching(/Session is full/) },
    });
    await ownerCreateBooking(db(), owner, { dogId: dogA, date: full, session: 'full', overrideReason: 'Extra place' });
    await setDayCapacity(db(), owner, { date: full, sessionCapacity: 20, taxiCapacity: 20 });

    const pup = await unapprovedDog(cass, 'Newbie');
    await approveVaccinations(db(), owner, cass, pup, [CORE, LEPTO, KC]);
    await expect(
      ownerCreateBooking(db(), owner, { dogId: pup, date: weekdayAhead(12), session: 'full' }),
    ).rejects.toMatchObject({
      fields: { overrideReason: expect.any(String) },
    });
    await ownerCreateBooking(db(), owner, {
      dogId: pup,
      date: weekdayAhead(84),
      session: 'full',
      overrideReason: 'Phone booking',
    });
    await ownerCreateBooking(db(), owner, { dogId: pup, date: weekdayAhead(85), session: 'full', trial: 'on' });
  });
});

describe('customer booking (D40, D73, D74)', () => {
  const book = (dates: string[]) =>
    previewMyBookings(db(), cass, { dogIds: [dogA], dates, session: 'full', taxi: false });

  for (const key of [CORE, LEPTO]) {
    for (const [state, msg] of BAD_STATES) {
      it(`${key} ${state}: the customer can’t book`, async () => {
        await setState(dogA, key, state);
        try {
          await expect(book([weekdayAhead(15)])).rejects.toBeInstanceOf(ValidationError);
          await expect(
            createMyBookings(db(), cass, { dogIds: [dogA], dates: [weekdayAhead(15)], session: 'full', taxi: false }),
          ).rejects.toMatchObject({
            fields: { dates: expect.stringMatching(msg) },
          });
        } finally {
          await setState(dogA, key, 'approved');
        }
      });
    }
  }

  it('a record running out before the date blocks that date only', async () => {
    const date = weekdayAhead(20);
    await db()
      .update(complianceSubmissions)
      .set({ expiresOn: addDays(date, -1) })
      .where(
        and(
          eq(complianceSubmissions.dogId, dogA),
          eq(complianceSubmissions.requirementKey, LEPTO),
          eq(complianceSubmissions.status, 'approved'),
        ),
      );
    await expect(book([date])).rejects.toMatchObject({
      fields: { dates: expect.stringMatching(/runs out before this date/) },
    });
    await setState(dogA, LEPTO, 'approved');
    await expect(book([date])).resolves.toBeTruthy();
  });

  it('first course: day 13 after it finished is blocked, day 14 is allowed, no date means no block', async () => {
    const date = weekdayAhead(5);
    await setPrimary(dogA, addDays(date, -13));
    await expect(book([date])).rejects.toMatchObject({
      fields: { dates: expect.stringMatching(/first course of vaccinations must be finished at least 14 days/) },
    });
    await setPrimary(dogA, addDays(date, -14));
    await expect(book([date])).resolves.toBeTruthy();
    await setPrimary(dogA, null);
    await expect(book([date])).resolves.toBeTruthy();
  });

  it('first course: the Owner can’t override the 14-day wait either', async () => {
    const date = weekdayAhead(86);
    await setPrimary(dogA, addDays(date, -13));
    await expect(
      ownerCreateBooking(db(), owner, { dogId: dogA, date, session: 'full', overrideReason: 'Please', trial: 'on' }),
    ).rejects.toMatchObject({ fields: { date: expect.stringMatching(/at least 14 days/) } });
    await setPrimary(dogA, addDays(date, -14));
    await ownerCreateBooking(db(), owner, { dogId: dogA, date, session: 'full' });
    await setPrimary(dogA, null);
  });
});

describe('waitlist offers (D41, D73)', () => {
  it('a waitlist place can’t be accepted while a licence vaccination is out of date', async () => {
    const date = weekdayAhead(60);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 0, taxiCapacity: 20 });
    const r = await createMyBookings(db(), cass, {
      dogIds: [dogA],
      dates: [date],
      session: 'full',
      taxi: false,
      ifFull: 'waitlist',
    });
    expect(r.outcomes[0]!.outcome).toBe('waitlisted');
    await setDayCapacity(db(), owner, { date, sessionCapacity: 20, taxiCapacity: 20 });
    const [w] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, dogA), eq(bookingDogs.serviceDate, date)));
    await offerPlace(db(), owner, w!.id, { version: w!.version });
    await setState(dogA, CORE, 'expired');
    try {
      await expect(acceptOffer(db(), cass, w!.id)).rejects.toThrow(
        /can’t be accepted yet: Core vaccinations has expired/,
      );
    } finally {
      await setState(dogA, CORE, 'approved');
    }
    await acceptOffer(db(), cass, w!.id);
    expect((await fresh(w!.id)).status).toMatch(/pending_payment|confirmed/);
  });
});

describe('membership book-ahead (D47, D73, D74)', () => {
  it('skips days inside the first-course wait and books from day 14', async () => {
    const dog = await approvedDog(db(), owner, cass, 'Member Moss');
    const r = await requestMembership(db(), cass, {
      dogId: dog,
      weekdays: [1, 2, 3, 4, 5],
      session: 'full',
      startsOn: nextMonday(),
    });
    const done = addDays(today, -1);
    await setPrimary(dog, done);
    const clear = addDays(done, 14);
    const [m] = await db().select().from(memberships).where(eq(memberships.id, r.id));
    const res = await approveMembership(db(), owner, r.id, { version: m!.version });
    const blocked = res.clashes.filter((c) => c.dogId === dog && /at least 14 days/.test(c.reason));
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every((c) => c.date < clear)).toBe(true);
    const rows = await db().select().from(bookingDogs).where(eq(bookingDogs.membershipId, r.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((b) => b.serviceDate >= clear)).toBe(true);
  });

  it('books nothing while leptospirosis is waiting for review', async () => {
    const dog = await approvedDog(db(), owner, cass, 'Member Mint');
    const r = await requestMembership(db(), cass, {
      dogId: dog,
      weekdays: [1, 2, 3, 4, 5],
      session: 'full',
      startsOn: nextMonday(),
    });
    await setState(dog, LEPTO, 'pending_review');
    const [m] = await db().select().from(memberships).where(eq(memberships.id, r.id));
    const res = await approveMembership(db(), owner, r.id, { version: m!.version });
    expect(res.clashes.filter((c) => c.dogId === dog).length).toBeGreaterThan(0);
    const rows = await db().select().from(bookingDogs).where(eq(bookingDogs.membershipId, r.id));
    expect(rows).toHaveLength(0);
  });
});

describe('check-in gate (D42, D73, D74)', () => {
  it('refuses check-in for every core/leptospirosis problem – no reason helps – then checks in once fixed', async () => {
    const bd = await bookToday(dogA);
    for (const key of [CORE, LEPTO]) {
      for (const [state, msg] of BAD_STATES) {
        await setState(dogA, key, state);
        const p = checkIn(db(), owner, bd.id, { version: bd.version, overrideReason: 'Owner says fine' });
        await expect(p).rejects.toBeInstanceOf(ConflictError);
        await expect(p).rejects.toThrow(msg);
        const day = await ownerDay(db(), owner, today);
        const row = day.booked.find((r) => r.id === bd.id)!;
        expect(row.checkInBlocked).toMatch(msg);
        expect(row.checkInNeedsReason).toBe(false);
        await setState(dogA, key, 'approved');
      }
    }
    expect((await fresh(bd.id)).status).toBe('confirmed');
    await checkIn(db(), owner, bd.id, { version: bd.version });
    expect((await fresh(bd.id)).status).toBe('attended');
  });

  it('kennel cough at check-in needs a reason, which is kept and audited without detail', async () => {
    const bd = await bookToday(dogKc);
    await setState(dogKc, KC, 'expired');
    const day = await ownerDay(db(), owner, today);
    expect(day.booked.find((r) => r.id === bd.id)).toMatchObject({ checkInBlocked: null, checkInNeedsReason: true });
    await expect(checkIn(db(), owner, bd.id, { version: bd.version })).rejects.toMatchObject({
      fields: { overrideReason: expect.stringMatching(/Kennel cough vaccination has expired/) },
    });
    await checkIn(db(), owner, bd.id, { version: bd.version, overrideReason: 'Booster tomorrow' });
    const after = await fresh(bd.id);
    expect(after.status).toBe('attended');
    expect(after.overrideReason).toContain('Check-in: Booster tomorrow');
    const [audit] = await db()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, bd.id), eq(auditEvents.action, 'attendance.checked_in_with_override')));
    expect(audit!.metadata).toEqual({ overrides: 1 });
    await setState(dogKc, KC, 'approved');
  });

  it('first course: blocked on day 13, allowed on day 14', async () => {
    const bd = await bookToday(dogPrimary);
    await setPrimary(dogPrimary, addDays(today, -13));
    await expect(checkIn(db(), owner, bd.id, { version: bd.version, overrideReason: 'x' })).rejects.toThrow(
      /at least 14 days/,
    );
    await setPrimary(dogPrimary, addDays(today, -14));
    await checkIn(db(), owner, bd.id, { version: bd.version });
    expect((await fresh(bd.id)).status).toBe('attended');
  });

  it('a dog with no problems checks in without a reason and nothing is stored', async () => {
    const dog = await approvedDog(db(), owner, cass, 'Plain Jane');
    const bd = await bookToday(dog);
    await checkIn(db(), owner, bd.id, { version: bd.version, overrideReason: 'ignored' });
    expect(await fresh(bd.id)).toMatchObject({ status: 'attended', overrideReason: 'Test day' });
  });
});

describe('first-course question on upload (D74)', () => {
  const upload = (dogId: string, extra: Record<string, unknown>) =>
    uploadVaccinationRecord(db(), storage, cass, {
      dogId,
      fileName: 'v.pdf',
      bytes: PDF,
      entries: [CORE, LEPTO].map((k) => ({
        requirementKey: k,
        expiresOn: addDays(today, 300),
        administeredOn: addDays(today, -30),
      })),
      firstCourse: undefined,
      ...extra,
    });
  let dog: string;
  beforeAll(async () => {
    dog = await unapprovedDog(cass, 'Puppy Poppy');
  });

  it('must be answered, and a yes needs a past date', async () => {
    await expect(upload(dog, {})).rejects.toMatchObject({
      fields: { firstCourse: expect.stringMatching(/first course/) },
    });
    await expect(upload(dog, { firstCourse: 'maybe' })).rejects.toMatchObject({
      fields: { firstCourse: expect.any(String) },
    });
    await expect(upload(dog, { firstCourse: 'yes' })).rejects.toMatchObject({
      fields: { primaryCourseCompletedOn: 'Enter the date the first course finished' },
    });
    await expect(upload(dog, { firstCourse: 'yes', primaryCourseCompletedOn: '12/09/2026' })).rejects.toMatchObject({
      fields: { primaryCourseCompletedOn: expect.any(String) },
    });
    await expect(
      upload(dog, { firstCourse: 'yes', primaryCourseCompletedOn: addDays(today, 1) }),
    ).rejects.toMatchObject({
      fields: { primaryCourseCompletedOn: expect.stringMatching(/future/) },
    });
  });

  it('“no” stores no date even if one was typed; “yes” stores it on each vaccination in the record', async () => {
    await upload(dog, { firstCourse: 'no', primaryCourseCompletedOn: addDays(today, -3) });
    let subs = await db()
      .select()
      .from(complianceSubmissions)
      .where(and(eq(complianceSubmissions.dogId, dog), eq(complianceSubmissions.status, 'pending_review')));
    expect(subs.map((s) => s.primaryCourseCompletedOn)).toEqual([null, null]);
    await upload(dog, { firstCourse: 'yes', primaryCourseCompletedOn: addDays(today, -3) });
    subs = await db()
      .select()
      .from(complianceSubmissions)
      .where(and(eq(complianceSubmissions.dogId, dog), eq(complianceSubmissions.status, 'pending_review')));
    expect(subs.map((s) => s.primaryCourseCompletedOn)).toEqual([addDays(today, -3), addDays(today, -3)]);
  });

  it('the Owner keeps, corrects or clears the date when reviewing', async () => {
    const subs = await db()
      .select()
      .from(complianceSubmissions)
      .where(and(eq(complianceSubmissions.dogId, dog), eq(complianceSubmissions.status, 'pending_review')));
    const core = subs.find((s) => s.requirementKey === CORE)!;
    const lepto = subs.find((s) => s.requirementKey === LEPTO)!;
    await expect(
      reviewSubmission(db(), owner, core.id, {
        decision: 'approve',
        expiresOn: core.expiresOn,
        version: core.version,
        primaryCourseCompletedOn: addDays(today, 2),
      }),
    ).rejects.toMatchObject({ fields: { primaryCourseCompletedOn: expect.stringMatching(/future/) } });
    await reviewSubmission(db(), owner, core.id, {
      decision: 'approve',
      expiresOn: core.expiresOn,
      version: core.version,
      primaryCourseCompletedOn: addDays(today, -5),
    });
    await reviewSubmission(db(), owner, lepto.id, {
      decision: 'approve',
      expiresOn: lepto.expiresOn,
      version: lepto.version,
    });
    const after = await db()
      .select()
      .from(complianceSubmissions)
      .where(inArray(complianceSubmissions.id, [core.id, lepto.id]));
    expect(after.find((s) => s.id === core.id)!.primaryCourseCompletedOn).toBe(addDays(today, -5)); // corrected
    expect(after.find((s) => s.id === lepto.id)!.primaryCourseCompletedOn).toBe(addDays(today, -3)); // kept

    await upload(dog, { firstCourse: 'yes', primaryCourseCompletedOn: addDays(today, -3) });
    const [again] = await db()
      .select()
      .from(complianceSubmissions)
      .where(
        and(
          eq(complianceSubmissions.dogId, dog),
          eq(complianceSubmissions.requirementKey, CORE),
          eq(complianceSubmissions.status, 'pending_review'),
        ),
      );
    await reviewSubmission(db(), owner, again!.id, {
      decision: 'approve',
      expiresOn: again!.expiresOn,
      version: again!.version,
      primaryCourseCompletedOn: '',
    });
    const [cleared] = await db().select().from(complianceSubmissions).where(eq(complianceSubmissions.id, again!.id));
    expect(cleared!.primaryCourseCompletedOn).toBeNull();
  });
});

describe('reminders at 60, 30, 14 and 7 days (D66, D75)', () => {
  it('migrated requirement rows and the column default use 60/30/14/7', async () => {
    const rows = await db().select().from(complianceRequirements).where(eq(complianceRequirements.kind, 'vaccination'));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(r.reminderDays).toEqual([60, 30, 14, 7]);
    const def = await db().execute(
      sql`select column_default from information_schema.columns where table_name = 'compliance_requirements' and column_name = 'reminder_days'`,
    );
    expect(String((def.rows[0] as { column_default: string }).column_default)).toContain('{60,30,14,7}');
  });

  it('the migration’s update only touches rows still on the old default', async () => {
    const file = readdirSync('drizzle').find((f) => /_vaccination_compliance\.sql$/.test(f))!;
    const update = readFileSync(join('drizzle', file), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .find((s) => /^(--.*\n)*UPDATE/m.test(s) && s.includes('UPDATE'))!;
    const set = (key: string, days: number[]) =>
      db().update(complianceRequirements).set({ reminderDays: days }).where(eq(complianceRequirements.key, key));
    try {
      await set(CORE, [30, 14, 7]);
      await set(KC, [21, 7]);
      await set(LEPTO, [45, 30, 14, 7]);
      await db().execute(sql.raw(update));
      const rows = await db()
        .select()
        .from(complianceRequirements)
        .where(inArray(complianceRequirements.key, [CORE, LEPTO, KC]));
      const by = Object.fromEntries(rows.map((r) => [r.key, r.reminderDays]));
      expect(by).toEqual({ [CORE]: [60, 30, 14, 7], [KC]: [21, 7], [LEPTO]: [45, 30, 14, 7] });
    } finally {
      for (const k of [CORE, LEPTO, KC]) await set(k, [60, 30, 14, 7]);
    }
  });

  it('sends the 60-day reminder once, catches up, then the 30-day one – never naming the vaccination', async () => {
    const dog = await approvedDog(db(), owner, cass, 'Reminder Rue');
    const expiry = addDays(today, 70);
    await db()
      .update(complianceSubmissions)
      .set({ expiresOn: expiry })
      .where(and(eq(complianceSubmissions.dogId, dog), eq(complianceSubmissions.status, 'approved')));
    const mine = () =>
      mail.sent.filter(
        (m) =>
          m.to === cass.email && m.template === 'compliance.vaccination-reminder' && m.text.includes('Reminder Rue'),
      );
    const keys = async () =>
      (
        await db()
          .select()
          .from(notificationLog)
          .where(like(notificationLog.key, `vaccination:${dog}:%`))
      ).map((k) => k.key.split(':').at(-1));
    mail.sent.length = 0;

    await sendVaccinationReminders(db(), system, londonInstant(addDays(expiry, -61), '09:00'));
    expect(mine()).toHaveLength(0);
    // First run 45 days out (e.g. the job was down): catch up with the 60-day reminder only.
    await sendVaccinationReminders(db(), system, londonInstant(addDays(expiry, -45), '09:00'));
    expect(mine()).toHaveLength(3);
    expect(mine()[0]!.text).not.toMatch(/leptospirosis|kennel|core|distemper/i);
    expect(await keys()).toEqual(['60', '60', '60']);
    await sendVaccinationReminders(db(), system, londonInstant(addDays(expiry, -45), '15:00'));
    await sendVaccinationReminders(db(), system, londonInstant(addDays(expiry, -31), '09:00'));
    expect(mine()).toHaveLength(3);
    await sendVaccinationReminders(db(), system, londonInstant(addDays(expiry, -30), '09:00'));
    expect(mine()).toHaveLength(6);
    expect((await keys()).sort()).toEqual(['30', '30', '30', '60', '60', '60']);
  });

  it('the Owner can set 60, 30, 14, 7 days, and can’t make the licence vaccinations optional', async () => {
    await updateRequirement(db(), owner, KC, {
      mandatory: 'on',
      blocksBooking: 'on',
      active: 'on',
      reminderDays: '7, 60 14,30',
    });
    const [kc] = await db().select().from(complianceRequirements).where(eq(complianceRequirements.key, KC));
    expect(kc!.reminderDays).toEqual([60, 30, 14, 7]);
    await expect(
      updateRequirement(db(), owner, KC, {
        mandatory: 'on',
        blocksBooking: 'on',
        active: 'on',
        reminderDays: '90, 60, 30, 14, 7, 1',
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    for (const key of [CORE, LEPTO])
      for (const off of [
        { mandatory: 'on', active: 'on' },
        { blocksBooking: 'on', active: 'on' },
        { mandatory: 'on', blocksBooking: 'on' },
      ])
        await expect(
          updateRequirement(db(), owner, key, { ...off, reminderDays: '60, 30, 14, 7' }),
        ).rejects.toMatchObject({
          message: expect.stringMatching(/licence requires/),
        });
    const rows = await db()
      .select()
      .from(complianceRequirements)
      .where(inArray(complianceRequirements.key, [CORE, LEPTO]));
    expect(rows.every((r) => r.mandatory && r.blocksBooking && r.active)).toBe(true);
  });
});
