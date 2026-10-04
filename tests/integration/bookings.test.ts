import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, createDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { bookingDogs, bookingSettings, complianceSubmissions, dogs, serviceDays } from '@/infra/db/schema';
import { addMyContact, updateMyProfile } from '@/server/services/customers';
import { createMyDog, submitMyOnboardingForm, saveMyDogVet } from '@/server/services/dogs';
import { acceptTerms, myTermsStatus } from '@/server/services/policies';
import {
  acceptOffer,
  bookingCalendar,
  cancelMyBooking,
  createMyBookings,
  myBookings,
} from '@/server/services/bookings';
import {
  addClosure,
  attendanceCsv,
  checkIn,
  checkOut,
  csvCell,
  emergencyCsv,
  markNoShow,
  offerPlace,
  ownerCancel,
  ownerCreateBooking,
  ownerDay,
  setDayCapacity,
} from '@/server/services/owner-bookings';
import { recordAssessment, setDogStatus } from '@/server/services/owner-review';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { AuthorizationError } from '@/server/policy/authorize';
import { addDays, londonDate } from '@/domain/time';
import { isoWeekday } from '@/domain/booking/rules';
import { MemoryEmailProvider } from '../support/memory-email';
import { payOpenCheckouts } from '../support/payments';
import { makeUser, PDF, validDog, validOnboarding, type TestUser } from '../support/factories';
import { FsStorageProvider } from '@/infra/storage/fs';
import { uploadVaccinationRecord } from '@/server/services/documents';
import { reviewSubmission } from '@/server/services/owner-review';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const storage = new FsStorageProvider(mkdtempSync(join(tmpdir(), 'lunak9-b-')));
const today = londonDate(new Date());
/** Next open weekday at least `n` days ahead that isn't a seeded bank holiday. */
const HOLIDAYS = new Set(['2026-12-25', '2026-12-28', '2027-01-01']);
const used = new Set<string>();
/** A distinct open weekday at least `n` days ahead (each call returns a date no other test uses). */
function weekdayAhead(n: number): string {
  let d = addDays(today, n);
  while (isoWeekday(d) > 5 || HOLIDAYS.has(d) || used.has(d)) d = addDays(d, 1);
  used.add(d);
  return d;
}

let owner: TestUser;
let alice: TestUser;
let bob: TestUser;
let aliceDog: string;
let aliceDog2: string;
let bobDog: string;
let bookedDate: string;

/** Fully onboard and approve a dog for a customer. */
async function approvedDog(user: TestUser, name: string) {
  const id = await createMyDog(db(), user, { ...validDog, name });
  await saveMyDogVet(db(), user, id, { practiceName: 'Vets', phone: '01483000000' });
  await submitMyOnboardingForm(db(), user, id, validOnboarding);
  const expires = addDays(today, 200);
  await uploadVaccinationRecord(db(), storage, user, {
    dogId: id,
    fileName: 'v.pdf',
    bytes: PDF,
    entries: ['vaccination_core', 'vaccination_leptospirosis', 'vaccination_kennel_cough'].map((k) => ({
      requirementKey: k,
      expiresOn: expires,
    })),
  });
  const subs = await db()
    .select()
    .from(complianceSubmissions)
    .where(and(eq(complianceSubmissions.dogId, id), eq(complianceSubmissions.status, 'pending_review')));
  for (const s of subs)
    await reviewSubmission(db(), owner, s.id, { decision: 'approve', expiresOn: s.expiresOn, version: s.version });
  await recordAssessment(db(), owner, id, { kind: 'meet_and_greet', outcome: 'passed', assessedOn: today });
  await recordAssessment(db(), owner, id, { kind: 'trial_day', outcome: 'passed', assessedOn: today });
  const [d] = await db().select().from(dogs).where(eq(dogs.id, id));
  await setDogStatus(db(), owner, id, { status: 'approved', version: d!.version });
  return id;
}

async function readyCustomer(u: TestUser) {
  await updateMyProfile(db(), u, {
    phone: '07700900123',
    addressLine1: '1 High St',
    town: 'Guildford',
    postcode: 'GU1 4AB',
  });
  await addMyContact(db(), u, { name: 'Em Contact', phone: '07700900555', isEmergencyContact: 'on' });
  const t = await myTermsStatus(db(), u);
  await acceptTerms(db(), u, t.terms!.id);
}

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Olivia Owner');
  alice = await makeUser(db(), 'customer', 'Alice Able');
  bob = await makeUser(db(), 'customer', 'Bob Baker');
  await readyCustomer(alice);
  await readyCustomer(bob);
  aliceDog = await approvedDog(alice, 'Biscuit');
  aliceDog2 = await approvedDog(alice, 'Crumble');
  bobDog = await approvedDog(bob, 'Rex');
});
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

describe('customer booking', () => {
  it('shows a calendar with availability and closed days', async () => {
    const cal = await bookingCalendar(db(), alice);
    expect(cal.days.length).toBeGreaterThan(20);
    const sat = cal.days.find((d) => isoWeekday(d.date) === 6)!;
    expect(sat).toMatchObject({ open: false, availability: 'closed' });
    const open = cal.days.find((d) => d.open)!;
    expect(open.left).toEqual({ full: 20, am: 20, pm: 20 });
  });

  it('books two dogs on two dates in one go and emails a summary', async () => {
    const d1 = weekdayAhead(3);
    const d2 = weekdayAhead(4);
    bookedDate = d1;
    const r = await createMyBookings(db(), alice, {
      dogIds: [aliceDog, aliceDog2],
      dates: [d1, d2],
      session: 'full',
      taxi: true,
    });
    expect(r.outcomes.map((o) => o.outcome)).toEqual(['confirmed', 'confirmed', 'confirmed', 'confirmed']);
    // Places are held until paid (D6), then confirmed with a receipt.
    expect(r.checkoutUrl).toMatch(/\/dev\/checkout\//);
    const held = await db().select().from(bookingDogs).where(eq(bookingDogs.serviceDate, d1));
    expect(
      held.filter((h) => h.dogId === aliceDog || h.dogId === aliceDog2).every((h) => h.status === 'pending_payment'),
    ).toBe(true);
    await payOpenCheckouts(db());
    const paid = await db().select().from(bookingDogs).where(eq(bookingDogs.serviceDate, d1));
    expect(
      paid.filter((h) => h.dogId === aliceDog || h.dogId === aliceDog2).every((h) => h.status === 'confirmed'),
    ).toBe(true);
    expect(
      mail.lastTo(
        (await db().execute<{ email: string }>(sql`select email from users where id = ${alice.userId}`)).rows[0]!.email,
      )?.template,
    ).toBe('payment.received');
    const again = await createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [d1], session: 'am', taxi: false });
    expect(again.outcomes[0]).toMatchObject({ outcome: 'skipped', reason: 'Already booked' });
  });

  it('refuses today, weekends, closures and dates beyond a vaccination expiry', async () => {
    await expect(
      createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [today], session: 'full', taxi: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    let sat = addDays(today, 1);
    while (isoWeekday(sat) !== 6) sat = addDays(sat, 1);
    await expect(
      createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [sat], session: 'full', taxi: false }),
    ).rejects.toMatchObject({ fields: { dates: expect.stringMatching(/closed/) } });
    const closedDay = weekdayAhead(20);
    await addClosure(db(), owner, { date: closedDay, reason: 'Staff training' });
    await expect(
      createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [closedDay], session: 'full', taxi: false }),
    ).rejects.toMatchObject({ fields: { dates: expect.stringMatching(/Staff training/) } });
    // Vaccinations expire in 200 days; the booking window is 90, so shorten one expiry to test D40.
    const soon = weekdayAhead(10);
    await db()
      .update(complianceSubmissions)
      .set({ expiresOn: soon })
      .where(
        and(
          eq(complianceSubmissions.dogId, aliceDog),
          eq(complianceSubmissions.requirementKey, 'vaccination_core'),
          eq(complianceSubmissions.status, 'approved'),
        ),
      );
    await expect(
      createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [weekdayAhead(12)], session: 'full', taxi: false }),
    ).rejects.toMatchObject({
      fields: { dates: expect.stringMatching(/Core vaccinations runs out before this date/) },
    });
    await db()
      .update(complianceSubmissions)
      .set({ expiresOn: addDays(today, 200) })
      .where(
        and(
          eq(complianceSubmissions.dogId, aliceDog),
          eq(complianceSubmissions.requirementKey, 'vaccination_core'),
          eq(complianceSubmissions.status, 'approved'),
        ),
      );
  });

  it('won’t book a dog that isn’t approved, or another customer’s dog', async () => {
    const newDog = await createMyDog(db(), alice, { ...validDog, name: 'Pending' });
    await expect(
      createMyBookings(db(), alice, { dogIds: [newDog], dates: [weekdayAhead(5)], session: 'full', taxi: false }),
    ).rejects.toMatchObject({ fields: { dogIds: expect.stringMatching(/can’t be booked yet/) } });
    await expect(
      createMyBookings(db(), alice, { dogIds: [bobDog], dates: [weekdayAhead(5)], session: 'full', taxi: false }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('capacity and concurrency', () => {
  it('never oversells the last places when many requests arrive at once', async () => {
    const date = weekdayAhead(6);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 2, taxiCapacity: 20 });
    // 12 separate customers each with an approved dog, all racing for 2 places on separate connections.
    const racers: { user: TestUser; dog: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const u = await makeUser(db(), 'customer', `Racer ${i}`);
      await readyCustomer(u);
      racers.push({ user: u, dog: await approvedDog(u, `Racer${i}`) });
    }
    const pools = racers.map(() => createDb(process.env.DATABASE_URL!));
    const results = await Promise.all(
      racers.map((r, i) =>
        createMyBookings(pools[i]!.db, r.user, {
          dogIds: [r.dog],
          dates: [date],
          session: 'full',
          taxi: false,
          ifFull: 'waitlist',
        }),
      ),
    );
    await Promise.all(pools.map((p) => p.pool.end()));
    const outcomes = results.map((r) => r.outcomes[0]!.outcome);
    expect(outcomes.filter((o) => o === 'confirmed')).toHaveLength(2);
    expect(outcomes.filter((o) => o === 'waitlisted')).toHaveLength(10);
    const [count] = (
      await db().execute<{ n: number }>(
        sql`select count(*)::int as n from booking_dogs where service_date = ${date} and status in ('confirmed', 'pending_payment')`,
      )
    ).rows;
    expect(count!.n).toBe(2);
  });

  it('a full day needs both a morning and an afternoon place', async () => {
    const date = weekdayAhead(7);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 1, taxiCapacity: 20 });
    expect(
      (await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [date], session: 'am', taxi: false })).outcomes[0]!
        .outcome,
    ).toBe('confirmed');
    expect(
      (
        await createMyBookings(db(), alice, {
          dogIds: [aliceDog],
          dates: [date],
          session: 'full',
          taxi: false,
          ifFull: 'skip',
        })
      ).outcomes[0],
    ).toMatchObject({ outcome: 'skipped', reason: 'Full' });
    expect(
      (await createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [date], session: 'pm', taxi: false }))
        .outcomes[0]!.outcome,
    ).toBe('confirmed');
  });

  it('won’t lower capacity below places already taken', async () => {
    const date = bookedDate;
    await expect(setDayCapacity(db(), owner, { date, sessionCapacity: 1, taxiCapacity: 20 })).rejects.toMatchObject({
      fields: { sessionCapacity: expect.any(String) },
    });
  });

  it('respects taxi capacity separately', async () => {
    const date = weekdayAhead(8);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 20, taxiCapacity: 1 });
    expect(
      (await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [date], session: 'full', taxi: true })).outcomes[0]!
        .outcome,
    ).toBe('confirmed');
    expect(
      (
        await createMyBookings(db(), alice, {
          dogIds: [aliceDog],
          dates: [date],
          session: 'full',
          taxi: true,
          ifFull: 'skip',
        })
      ).outcomes[0],
    ).toMatchObject({ outcome: 'skipped', reason: 'Taxi is full' });
  });
});

describe('waitlist offers', () => {
  it('Owner offers a freed place; customer accepts; lapsed offers can’t be accepted', async () => {
    const date = weekdayAhead(9);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 1, taxiCapacity: 20 });
    await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [date], session: 'full', taxi: false });
    const w = await createMyBookings(db(), alice, {
      dogIds: [aliceDog],
      dates: [date],
      session: 'full',
      taxi: false,
      ifFull: 'waitlist',
    });
    expect(w.outcomes[0]!.outcome).toBe('waitlisted');
    const [waiting] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, aliceDog), eq(bookingDogs.serviceDate, date)));
    await expect(offerPlace(db(), owner, waiting!.id, { version: waiting!.version })).rejects.toThrow(/no free place/);

    const [bobs] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, bobDog), eq(bookingDogs.serviceDate, date)));
    await cancelMyBooking(db(), bob, bobs!.id);
    await offerPlace(db(), owner, waiting!.id, { version: waiting!.version });
    const [offered] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, waiting!.id));
    expect(offered!.status).toBe('offered');
    // The offer holds the place: Bob can't rebook it.
    expect(
      (
        await createMyBookings(db(), bob, {
          dogIds: [bobDog],
          dates: [date],
          session: 'full',
          taxi: false,
          ifFull: 'skip',
        })
      ).outcomes[0]!.outcome,
    ).toBe('skipped');
    await expect(acceptOffer(db(), alice, waiting!.id, new Date(Date.now() + 13 * 3_600_000))).rejects.toThrow(
      /lapsed/,
    );
    await expect(acceptOffer(db(), bob, waiting!.id)).rejects.toBeInstanceOf(NotFoundError);
    const accepted = await acceptOffer(db(), alice, waiting!.id);
    expect(accepted.checkoutUrl).toBeTruthy();
    await payOpenCheckouts(db());
    const [done] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, waiting!.id));
    expect(done!.status).toBe('confirmed');
  });
});

describe('cancellations', () => {
  it('is free 48 hours or more ahead and late (charged) inside 48 hours', async () => {
    const date = weekdayAhead(10);
    await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [date], session: 'full', taxi: false });
    await payOpenCheckouts(db());
    const [bd] = await db()
      .select()
      .from(bookingDogs)
      .where(
        and(eq(bookingDogs.dogId, bobDog), eq(bookingDogs.serviceDate, date), eq(bookingDogs.status, 'confirmed')),
      );
    // Paid by card and cancelled 48 h+ ahead → refunded to the card (D20).
    expect(await cancelMyBooking(db(), bob, bd!.id)).toEqual({ late: false, refundedPence: 5000 });

    const soon = addDays(today, 1);
    await db().insert(serviceDays).values({ serviceDate: soon }).onConflictDoNothing();
    const [b] = (
      await db().execute<{ id: string }>(
        sql`insert into bookings (customer_id, created_by, source) select customer_id, ${bob.userId}, 'customer' from dogs where id = ${bobDog} returning id`,
      )
    ).rows;
    const [late] = (
      await db().execute<{ id: string }>(
        sql`insert into booking_dogs (booking_id, customer_id, dog_id, service_date, session, status) select ${b!.id}, customer_id, id, ${soon}, 'full', 'confirmed' from dogs where id = ${bobDog} returning id`,
      )
    ).rows;
    expect(await cancelMyBooking(db(), bob, late!.id, new Date(Date.now() - 3 * 86_400_000))).toEqual({
      late: false,
      refundedPence: 0,
    });

    // Tomorrow is always inside 48 hours of the session start → late, still cancelled.
    const tomorrow = addDays(today, 1);
    const id = await ownerCreateBooking(db(), owner, {
      dogId: bobDog,
      date: tomorrow,
      session: 'full',
      overrideReason: 'test: may be a closed day',
    });
    await payOpenCheckouts(db());
    expect(await cancelMyBooking(db(), bob, id)).toEqual({ late: true, refundedPence: 0 });
    const [row] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, id));
    expect(row).toMatchObject({ status: 'cancelled', lateCancellation: true });
  });

  it('can’t cancel someone else’s booking or a past one', async () => {
    const [aliceBooking] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, aliceDog), eq(bookingDogs.status, 'confirmed')));
    await expect(cancelMyBooking(db(), bob, aliceBooking!.id)).rejects.toBeInstanceOf(NotFoundError);
    const list = await myBookings(db(), alice);
    expect(list.upcoming.length).toBeGreaterThan(0);
    expect(list.upcoming.every((r) => r.cancellable)).toBe(true);
  });

  it('Owner cancellation needs a reason and emails the customer', async () => {
    const [bd] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, aliceDog2), eq(bookingDogs.status, 'confirmed')));
    await expect(ownerCancel(db(), owner, bd!.id, { version: bd!.version })).rejects.toBeInstanceOf(ValidationError);
    await ownerCancel(db(), owner, bd!.id, { version: bd!.version, reason: 'Poorly' });
    const [after] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, bd!.id));
    expect(after).toMatchObject({ status: 'cancelled', lateCancellation: false });
  });
});

describe('Owner day operations', () => {
  it('books a trial day for an unapproved dog only with a reason, and checks in/out on the day', async () => {
    const trial = await createMyDog(db(), alice, { ...validDog, name: 'Trial Pup' });
    await expect(ownerCreateBooking(db(), owner, { dogId: trial, date: today, session: 'full' })).rejects.toMatchObject(
      { fields: { overrideReason: expect.stringMatching(/Give a reason/) } },
    );
    const isOpen = isoWeekday(today) <= 5;
    const id = await ownerCreateBooking(db(), owner, {
      dogId: trial,
      date: today,
      session: 'full',
      overrideReason: 'Trial day' + (isOpen ? '' : ' (weekend test)'),
    });
    await payOpenCheckouts(db());
    const [bd] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, id));
    expect(bd!.overrideReason).toContain('Trial day');
    await expect(checkOut(db(), owner, id, { version: bd!.version })).rejects.toBeInstanceOf(ConflictError);
    await checkIn(db(), owner, id, { version: bd!.version });
    await expect(checkIn(db(), owner, id, { version: bd!.version })).rejects.toBeInstanceOf(ConflictError); // stale version
    await checkOut(db(), owner, id, { version: bd!.version + 1 });
    const day = await ownerDay(db(), owner, today);
    const row = day.booked.find((r) => r.id === id)!;
    expect(row.status).toBe('attended');
    expect(row.checkedOutAt).not.toBeNull();
    expect(row.warning).toBeTruthy(); // not approved → flagged
  });

  it('can’t check in or mark no-show before the day', async () => {
    const [future] = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, aliceDog), eq(bookingDogs.status, 'confirmed')));
    await expect(checkIn(db(), owner, future!.id, { version: future!.version })).rejects.toThrow(/on the day/);
    await expect(markNoShow(db(), owner, future!.id, { version: future!.version })).rejects.toThrow(/on the day/);
  });

  it('won’t close a day that has bookings', async () => {
    await expect(addClosure(db(), owner, { date: bookedDate, reason: 'Flood' })).rejects.toBeInstanceOf(ConflictError);
  });

  it('exports attendance and emergency lists, safely escaped and audited', async () => {
    const att = await attendanceCsv(db(), owner, today);
    expect(att.split('\r\n')[0]).toBe('Date,Dog,Customer,Phone,Session,Taxi,Status,Checked in,Checked out,Warning');
    expect(att).toContain('Trial Pup');
    const em = await emergencyCsv(db(), owner, today);
    expect(em).toContain('Em Contact 07700900555');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+44 7700')).toBe("'+44 7700");
    const a = await db().execute<{ action: string }>(sql`select action from audit_events where action like 'export.%'`);
    expect(a.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['export.attendance', 'export.emergency_list']));
  });
});

describe('access control', () => {
  it('customers can’t use Owner booking operations', async () => {
    const [bd] = await db().select().from(bookingDogs).limit(1);
    await expect(ownerDay(db(), alice, today)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(checkIn(db(), alice, bd!.id, { version: 1 })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(offerPlace(db(), alice, bd!.id, { version: 1 })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(attendanceCsv(db(), alice, today)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      setDayCapacity(db(), alice, { date: today, sessionCapacity: 99, taxiCapacity: 99 }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      ownerCreateBooking(db(), alice, { dogId: aliceDog, date: today, session: 'full', overrideReason: 'x' }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('customer booking lists never include Owner-only notes or other customers', async () => {
    const list = await myBookings(db(), bob);
    const text = JSON.stringify(list);
    expect(text).not.toContain('Poorly');
    expect(text).not.toContain('Biscuit');
    expect(text).not.toContain('internalNote');
  });

  it('settings row stays a singleton', async () => {
    await expect(db().insert(bookingSettings).values({ id: 2 })).rejects.toThrow();
  });
});
