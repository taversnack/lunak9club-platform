import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import {
  auditEvents,
  memberships,
  approvalRequests,
  bookingDogs,
  checkoutAttempts,
  complianceSubmissions,
  customers,
  dogs,
} from '@/infra/db/schema';
import { FsStorageProvider } from '@/infra/storage/fs';
import { addMyContact, updateMyProfile } from '@/server/services/customers';
import { createMyDog, saveMyDogVet, submitMyOnboardingForm } from '@/server/services/dogs';
import { uploadVaccinationRecord } from '@/server/services/documents';
import { acceptTerms, myTermsStatus } from '@/server/services/policies';
import { recordAssessment, reviewSubmission, setDogStatus } from '@/server/services/owner-review';
import { cancelMyBooking, createMyBookings, leaveWaitlist, myBookings } from '@/server/services/bookings';
import {
  giveWaitlistPlace,
  ownerCancel,
  ownerCreateBooking,
  ownerDay,
  setDayCapacity,
} from '@/server/services/owner-bookings';
import {
  approveApprovalRequest,
  createApprovalRequest,
  myApprovalRequests,
  ownerApprovalList,
  pendingApprovalCount,
  rejectApprovalRequest,
  withdrawMyApprovalRequest,
} from '@/server/services/approvals';
import { BOOKING_REQUEST, bookingSubjectKey, expireBookingRequests } from '@/server/services/booking-requests';
import { addCustomerRate } from '@/server/services/pricing';
import { runTick } from '@/server/services/jobs';
import {
  bookingsMissingPayLink,
  checkoutRetry,
  myHoldsWithoutPayLink,
  PayLinkBusyError,
  PayLinkUnavailableError,
  payForMyBooking,
  releaseExpiredCheckouts,
  resendPayLink,
  resumeCheckoutUrl,
} from '@/server/services/payments';
import { ConflictError, NotFoundError } from '@/server/errors';
import { AuthorizationError, type Actor } from '@/server/policy/authorize';
import { addDays, londonDate } from '@/domain/time';

import { PAY_TO_SECURE_KEY, REQUEST_NOT_SECURED, REQUEST_NOT_SECURED_KEY } from '@/domain/booking/wording';
import { formatDateTimeLondon } from '@/ui/format';
import { weekdayPicker } from '../support/dates';
import { MemoryEmailProvider } from '../support/memory-email';
import { payOpenCheckouts, simulated } from '../support/payments';
import { makeUser, PDF, validDog, validOnboarding, type TestUser } from '../support/factories';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const storage = new FsStorageProvider(mkdtempSync(join(tmpdir(), 'lunak9-r-')));
const today = londonDate(new Date());
const system: Actor = { kind: 'system', job: 'test' };
const weekdayAhead = weekdayPicker({ base: 40 });

/** Reused by the pay-link tests (other customers' dogs) so they need no extra dates. */
let payDate = '';
let owner: TestUser;
let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let aliceDog: string;
let aliceDog2: string;
let bobDog: string;
let carolDog: string;
let newDog: string;

async function onboardedDog(user: TestUser, name: string, approve = true) {
  const id = await createMyDog(db(), user, { ...validDog, name });
  await saveMyDogVet(db(), user, id, { practiceName: 'Vets', phone: '01483000000', agreedVet: 'same' });
  await submitMyOnboardingForm(db(), user, id, validOnboarding);
  await uploadVaccinationRecord(db(), storage, user, {
    dogId: id,
    fileName: 'v.pdf',
    bytes: PDF,
    firstCourse: 'no',
    entries: ['vaccination_core', 'vaccination_leptospirosis', 'vaccination_kennel_cough'].map((k) => ({
      requirementKey: k,
      expiresOn: addDays(today, 200),
      administeredOn: addDays(today, -30),
    })),
  });
  // Vaccination records are accepted even for a dog not approved yet: licence vaccinations must be
  // valid on the day for any booking, trial requests included (D73, D85).
  const subs = await db()
    .select()
    .from(complianceSubmissions)
    .where(and(eq(complianceSubmissions.dogId, id), eq(complianceSubmissions.status, 'pending_review')));
  for (const s of subs)
    await reviewSubmission(db(), owner, s.id, { decision: 'approve', expiresOn: s.expiresOn, version: s.version });
  if (!approve) return id;
  await recordAssessment(db(), owner, id, { kind: 'meet_and_greet', outcome: 'passed', assessedOn: today });
  await recordAssessment(db(), owner, id, { kind: 'trial_day', outcome: 'passed', assessedOn: today });
  const [d] = await db().select().from(dogs).where(eq(dogs.id, id));
  await setDogStatus(db(), owner, id, { status: 'approved', version: d!.version });
  return id;
}

async function ready(u: TestUser) {
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

/** A membership row for a dog (membership days need one, D47). */
async function membershipFor(user: TestUser, dogId: string) {
  const [c] = await db().select().from(customers).where(eq(customers.userId, user.userId));
  const [m] = await db()
    .insert(memberships)
    .values({
      customerId: c!.id,
      dogId,
      weekdays: [1],
      session: 'full',
      status: 'ended',
      startsOn: today,
      requestedBy: user.userId,
    })
    .returning({ id: memberships.id });
  return m!.id;
}

const rowsOf = (bookingId: string) => db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, bookingId));
const rowOf = async (dogId: string, date: string) =>
  (
    await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, dogId), eq(bookingDogs.serviceDate, date)))
  ).at(-1)!;
const requestOf = async (id: string) =>
  (await db().select().from(approvalRequests).where(eq(approvalRequests.id, id)))[0]!;
const OWNER_NOTE = 'Sorry Alice – Rex had a scuffle so we are keeping numbers down';

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Olivia Owner');
  alice = await makeUser(db(), 'customer', 'Alice Able');
  bob = await makeUser(db(), 'customer', 'Bob Baker');
  carol = await makeUser(db(), 'customer', 'Carol Cole');
  for (const u of [alice, bob, carol]) await ready(u);
  aliceDog = await onboardedDog(alice, 'Biscuit');
  aliceDog2 = await onboardedDog(alice, 'Crumble');
  bobDog = await onboardedDog(bob, 'Rex');
  carolDog = await onboardedDog(carol, 'Pip');
  newDog = await onboardedDog(alice, 'Newbie', false);
});
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

describe('booking requests (D76)', () => {
  it('a request holds the place, takes no payment and says it does not secure the booking', async () => {
    const date = weekdayAhead(5);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 1, taxiCapacity: 20 });
    mail.sent.length = 0;
    const r = await createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [date], session: 'full', taxi: false });
    expect(r.outcomes.map((o) => o.outcome)).toEqual(['requested']);
    expect(r.totalPence).toBe(5000);
    const [row] = await rowsOf(r.bookingId);
    expect(row!.status).toBe('requested');
    expect(row!.offerExpiresAt).toBeNull();
    expect(await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.bookingId, r.bookingId))).toHaveLength(
      0,
    );
    // Customer confirmation email: the agreed wording (D76).
    const confirm = mail.sent.find((m) => m.to === alice.email && m.template === 'booking.requested')!;
    expect(confirm.text).toContain(REQUEST_NOT_SECURED_KEY);
    expect(confirm.text).toContain(REQUEST_NOT_SECURED);
    expect(confirm.html).toContain(REQUEST_NOT_SECURED_KEY);
    expect(mail.sent.some((m) => m.to === owner.email && m.template === 'approval.owner-new')).toBe(true);
    // The place is held: Bob goes on the waitlist.
    const b = await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [date], session: 'am', taxi: false });
    expect(b.outcomes[0]!.outcome).toBe('waitlisted');
    expect(b.requestId).toBeNull();
    const day = await ownerDay(db(), owner, date);
    expect(day.requests.map((x) => x.dogName)).toEqual(['Biscuit']);
    expect(day.waitlist.map((x) => x.dogName)).toEqual(['Rex']);
    // Owner list: oldest first, with context (dogs, places left, links).
    const list = await ownerApprovalList(db(), owner);
    const item = list.find((x) => x.id === r.requestId)!;
    expect(item.summary).toContain('£50.00');
    expect(item.context[0]!.lines[0]).toContain('Biscuit');
    expect(item.context[1]!.lines[0]).toContain('Places left: 0 morning');
    expect(await pendingApprovalCount(db(), owner)).toBeGreaterThan(0);
  });

  it('approve → held for payment with a pay link, deadline and "pay to secure" → paid → confirmed', async () => {
    const date = weekdayAhead(8);
    payDate = date;
    const r = await createMyBookings(db(), alice, {
      dogIds: [aliceDog, aliceDog2],
      dates: [date],
      session: 'full',
      taxi: true,
    });
    mail.sent.length = 0;
    const now = new Date();
    await approveApprovalRequest(db(), owner, r.requestId!, { reason: OWNER_NOTE }, now);
    const rows = await rowsOf(r.bookingId);
    expect(rows.every((x) => x.status === 'pending_payment')).toBe(true);
    const hold = rows[0]!.offerExpiresAt!;
    // D78: 24 hours (Stripe max 23:55) or until the session starts, at least 31 minutes.
    expect(hold.getTime() - now.getTime()).toBeGreaterThan(23 * 3_600_000);
    const [attempt] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.bookingId, r.bookingId));
    expect(attempt!.status).toBe('open');
    const email = mail.sent.find((m) => m.to === alice.email && m.template === 'booking.request-approved')!;
    expect(email.text).toContain(PAY_TO_SECURE_KEY);
    expect(email.text).toContain(`/api/payments/pay/${attempt!.id}`);
    expect(email.html).toContain(`/api/payments/pay/${attempt!.id}`);
    expect(email.text).toContain(formatDateTimeLondon(attempt!.expiresAt));
    // The Owner's note is never emailed – it's in the portal only (D80).
    expect(mail.sent.some((m) => m.text.includes('scuffle') || m.html.includes('scuffle'))).toBe(false);
    expect(mail.sent.some((m) => m.template === 'approval.approved')).toBe(false);
    const mine = await myApprovalRequests(db(), alice, { status: 'all' });
    expect(mine.find((x) => x.id === r.requestId)!.reason).toBe(OWNER_NOTE);
    await payOpenCheckouts(db());
    expect((await rowsOf(r.bookingId)).every((x) => x.status === 'confirmed')).toBe(true);
    // Decisions are audited without the note.
    const audits = await db().select().from(auditEvents).where(eq(auditEvents.entityId, r.requestId!));
    expect(audits.map((a) => a.action)).toContain('approval.approved');
    expect(JSON.stringify(audits)).not.toContain('scuffle');
  });

  it('£0 and membership days are confirmed on approval without payment (D83)', async () => {
    const [c] = await db().select().from(customers).where(eq(customers.userId, carol.userId));
    await addCustomerRate(db(), owner, c!.id, { fullDay: '0', startsOn: today, reason: 'Staff dog' });
    const date = weekdayAhead(9);
    const r = await createMyBookings(db(), carol, { dogIds: [carolDog], dates: [date], session: 'full', taxi: false });
    expect(r.totalPence).toBe(0);
    mail.sent.length = 0;
    await approveApprovalRequest(db(), owner, r.requestId!);
    expect((await rowsOf(r.bookingId))[0]!.status).toBe('confirmed');
    expect(await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.bookingId, r.bookingId))).toHaveLength(
      0,
    );
    expect(mail.sent.some((m) => m.to === carol.email && m.template === 'booking.summary')).toBe(true);

    const d2 = weekdayAhead(10);
    const m = await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [d2], session: 'full', taxi: false });
    await db()
      .update(bookingDogs)
      .set({ kind: 'membership', membershipId: await membershipFor(bob, bobDog) })
      .where(eq(bookingDogs.bookingId, m.bookingId));
    await approveApprovalRequest(db(), owner, m.requestId!);
    expect((await rowsOf(m.bookingId))[0]!.status).toBe('confirmed');
  });

  it('decline releases the place with a polite email and no note', async () => {
    const date = weekdayAhead(12);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 1, taxiCapacity: 20 });
    const r = await createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [date], session: 'full', taxi: false });
    mail.sent.length = 0;
    await rejectApprovalRequest(db(), owner, r.requestId!, { reason: OWNER_NOTE });
    expect((await rowsOf(r.bookingId))[0]!.status).toBe('rejected');
    const email = mail.sent.find((m) => m.to === alice.email && m.template === 'approval.rejected')!;
    expect(email.text).toMatch(/Unfortunately we can’t accept it this time/);
    expect(email.text + email.html).not.toContain('scuffle');
    // The place is free again.
    const b = await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [date], session: 'full', taxi: false });
    expect(b.outcomes[0]!.outcome).toBe('requested');
    await expect(approveApprovalRequest(db(), owner, r.requestId!)).rejects.toBeInstanceOf(ConflictError);
  });

  it('the customer withdraws a request, or one day of it, at no charge', async () => {
    const d1 = weekdayAhead(14);
    const d2 = weekdayAhead(15);
    const r = await createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [d1, d2], session: 'am', taxi: false });
    const [first] = (await rowsOf(r.bookingId)).filter((x) => x.serviceDate === d1);
    await cancelMyBooking(db(), alice, first!.id);
    expect((await rowOf(aliceDog, d1)).status).toBe('cancelled');
    expect((await requestOf(r.requestId!)).status).toBe('pending');
    await expect(withdrawMyApprovalRequest(db(), bob, r.requestId!)).rejects.toBeInstanceOf(NotFoundError);
    mail.sent.length = 0;
    await withdrawMyApprovalRequest(db(), alice, r.requestId!);
    expect((await rowOf(aliceDog, d2)).status).toBe('cancelled');
    expect((await rowOf(aliceDog, d2)).lateCancellation).toBe(false);
    expect(mail.sent.filter((m) => m.to === alice.email && m.template === 'approval.withdrawn')).toHaveLength(1);
  });

  it('the Owner declines one day first, then approves the rest', async () => {
    const d1 = weekdayAhead(16);
    const d2 = weekdayAhead(17);
    const r = await createMyBookings(db(), alice, {
      dogIds: [aliceDog],
      dates: [d1, d2],
      session: 'full',
      taxi: false,
    });
    const one = await rowOf(aliceDog, d1);
    mail.sent.length = 0;
    await ownerCancel(db(), owner, one.id, { version: one.version, reason: OWNER_NOTE });
    expect((await rowOf(aliceDog, d1)).status).toBe('rejected');
    const email = mail.lastTo(alice.email)!;
    expect(email.template).toBe('booking.cancelled');
    expect(email.text).not.toContain('scuffle');
    await approveApprovalRequest(db(), owner, r.requestId!);
    expect((await rowOf(aliceDog, d1)).status).toBe('rejected');
    expect((await rowOf(aliceDog, d2)).status).toBe('pending_payment');
    const [attempt] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.bookingId, r.bookingId));
    expect(attempt!.amountPence).toBe(5000);
  });

  it('declining the last day declines the whole request', async () => {
    const d = weekdayAhead(18);
    const r = await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [d], session: 'full', taxi: false });
    const row = await rowOf(bobDog, d);
    await ownerCancel(db(), owner, row.id, { version: row.version, reason: 'Full team training day' });
    expect((await requestOf(r.requestId!)).status).toBe('rejected');
  });

  it('only one pending request per subject', async () => {
    const d = weekdayAhead(19);
    const r = await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [d], session: 'pm', taxi: false });
    const [c] = await db().select().from(customers).where(eq(customers.userId, bob.userId));
    await expect(
      createApprovalRequest(db(), bob, {
        type: BOOKING_REQUEST,
        customerId: c!.id,
        subjectKey: bookingSubjectKey(r.bookingId),
        payload: {
          bookingId: r.bookingId,
          bookingDogIds: [(await rowOf(bobDog, d)).id],
          kind: 'standard',
          totalPence: 1,
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('requests close at the cut-off: one email per request, nothing charged (D79)', async () => {
    const d1 = weekdayAhead(21);
    const d2 = weekdayAhead(22);
    const whole = await createMyBookings(db(), carol, {
      dogIds: [carolDog],
      dates: [d1],
      session: 'full',
      taxi: false,
    });
    const part = await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [d1, d2], session: 'full', taxi: false });
    mail.sent.length = 0;
    const atMidnight = new Date(`${d1}T00:30:00Z`);
    await expireBookingRequests(db(), system, new Date(`${addDays(d1, -1)}T21:00:00Z`)); // 22:00 BST/21:00 GMT the day before
    expect((await rowOf(carolDog, d1)).status).toBe('requested');
    await expireBookingRequests(db(), system, atMidnight);
    await expireBookingRequests(db(), system, atMidnight);
    expect((await requestOf(whole.requestId!)).status).toBe('expired');
    expect((await rowOf(carolDog, d1)).status).toBe('cancelled');
    expect(mail.sent.filter((m) => m.to === carol.email).map((m) => m.template)).toEqual(['approval.expired']);
    expect((await requestOf(part.requestId!)).status).toBe('pending');
    expect((await rowOf(bobDog, d1)).status).toBe('cancelled');
    expect((await rowOf(bobDog, d2)).status).toBe('requested');
    // Bob's older requests for earlier days close too; this one gets a single "days closed" email.
    expect(mail.sent.filter((m) => m.to === bob.email && m.template === 'booking.summary')).toHaveLength(1);
    await expect(expireBookingRequests(db(), alice)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('unpaid holds lapse through releaseExpiredCheckouts with the "booking not completed" email', async () => {
    const d = weekdayAhead(24);
    const r = await createMyBookings(db(), carol, { dogIds: [carolDog], dates: [d], session: 'am', taxi: false });
    await db().update(bookingDogs).set({ kind: 'standard' }).where(eq(bookingDogs.bookingId, r.bookingId));
    // Carol's £0 rate means no payment; use Alice for a priced hold.
    const a = await createMyBookings(db(), alice, { dogIds: [aliceDog2], dates: [d], session: 'am', taxi: false });
    await approveApprovalRequest(db(), owner, a.requestId!);
    mail.sent.length = 0;
    await releaseExpiredCheckouts(db(), new Date(Date.now() + 25 * 3_600_000));
    expect((await rowOf(aliceDog2, d)).status).toBe('cancelled');
    expect(mail.sent.some((m) => m.to === alice.email && m.template === 'payment.hold-released')).toBe(true);
  });

  it('customers can request a trial day for a dog not yet approved (D85)', async () => {
    const d = weekdayAhead(26);
    await expect(
      createMyBookings(db(), alice, { dogIds: [newDog], dates: [d], session: 'full', taxi: false }),
    ).rejects.toThrow();
    await expect(
      createMyBookings(db(), alice, {
        dogIds: [newDog],
        dates: [d, weekdayAhead(27)],
        session: 'full',
        taxi: false,
        trial: true,
      }),
    ).rejects.toThrow();
    const r = await createMyBookings(db(), alice, {
      dogIds: [newDog],
      dates: [d],
      session: 'full',
      taxi: false,
      trial: true,
    });
    const row = await rowOf(newDog, d);
    expect(row.kind).toBe('trial');
    expect(row.status).toBe('requested');
    expect((await requestOf(r.requestId!)).payload).toMatchObject({ kind: 'trial' });
  });
});

describe('Owner context on Requests (Developer 1 gap c)', () => {
  it('lists the other dogs already booked that day, with links to them and the day view', async () => {
    const date = weekdayAhead(11);
    await ownerCreateBooking(db(), owner, { dogId: bobDog, date, session: 'full' });
    const r = await createMyBookings(db(), carol, { dogIds: [carolDog], dates: [date], session: 'am', taxi: false });
    const item = (await ownerApprovalList(db(), owner)).find((x) => x.id === r.requestId)!;
    const day = item.context.find((c) => c.heading.includes('dogs already booked'))!;
    expect(day.lines.join(' ')).toMatch(/Already booked: Rex \(Full day, awaiting payment\)/);
    expect(day.lines.join(' ')).not.toMatch(/Already booked:.*Pip/);
    expect(day.links).toEqual(
      expect.arrayContaining([
        { label: expect.stringMatching(/^Day view/), href: `/admin/bookings?date=${date}` },
        { label: 'Rex', href: `/admin/dogs/${bobDog}` },
      ]),
    );
    await withdrawMyApprovalRequest(db(), carol, r.requestId!);
  });
});

describe('pay links when the card service is down', () => {
  const down = () => new Error('provider unreachable');
  const attemptsFor = (bookingId: string) =>
    db().select().from(checkoutAttempts).where(eq(checkoutAttempts.bookingId, bookingId));
  // The date from the approve-and-pay test, with other dogs, so no extra dates are used.
  async function approvedWith(failures: number, who: TestUser, dog: string) {
    checkoutRetry.delayMs = 0;
    const date = payDate;
    const r = await createMyBookings(db(), who, { dogIds: [dog], dates: [date], session: 'full', taxi: false });
    const spy = vi.spyOn(simulated(), 'createCheckout');
    for (let i = 0; i < failures; i++) spy.mockRejectedValueOnce(down());
    mail.sent.length = 0;
    await approveApprovalRequest(db(), owner, r.requestId!);
    spy.mockRestore();
    return { ...r, date, spy };
  }

  it('retries opening the checkout and sends the pay link once it works', async () => {
    const r = await approvedWith(2, bob, await onboardedDog(bob, 'Retry'));
    const attempts = await attemptsFor(r.bookingId);
    expect(attempts.map((a) => a.status)).toEqual(['open']);
    expect(mail.sent.filter((m) => m.to === bob.email && m.template === 'booking.request-approved')).toHaveLength(1);
    await payOpenCheckouts(db());
    expect((await rowsOf(r.bookingId))[0]!.status).toBe('confirmed');
  });

  it('a persistent failure keeps the hold, shows the Owner, and the customer can pay on demand without duplicates', async () => {
    const r = await approvedWith(3, bob, bobDog);
    // The request is approved and the place held, but there's no working link and no pay email.
    expect((await requestOf(r.requestId!)).status).toBe('approved');
    const [row] = await rowsOf(r.bookingId);
    expect(row!.status).toBe('pending_payment');
    const [failed] = await attemptsFor(r.bookingId);
    expect(failed!.status).toBe('failed');
    expect(mail.sent.some((m) => m.to === bob.email && m.template === 'booking.request-approved')).toBe(false);
    const audits = await db().select().from(auditEvents).where(eq(auditEvents.entityId, r.bookingId));
    expect(audits.map((a) => a.action)).toContain('payment.checkout_failed');
    // The Owner sees it on Requests and on the day view.
    const missing = await bookingsMissingPayLink(db(), owner);
    expect(missing.find((m) => m.bookingId === r.bookingId)?.failedAt).toBeInstanceOf(Date);
    const day = await ownerDay(db(), owner, r.date);
    expect(day.booked.find((x) => x.id === row!.id)?.payLinkMissing).toBe(true);
    // The customer sees "Pay now"; while the service is still down they get a friendly error and keep the place.
    expect((await myHoldsWithoutPayLink(db(), bob)).map((h) => h.bookingId)).toContain(r.bookingId);
    const spy = vi.spyOn(simulated(), 'createCheckout').mockRejectedValue(down());
    await expect(payForMyBooking(db(), bob, r.bookingId)).rejects.toBeInstanceOf(PayLinkUnavailableError);
    await expect(payForMyBooking(db(), bob, r.bookingId)).rejects.toThrow(/couldn’t create your payment link/);
    spy.mockRestore();
    expect((await rowsOf(r.bookingId))[0]!.status).toBe('pending_payment');
    // Service back: the old link in any email (failed attempt id) now creates one lazily…
    const first = await resumeCheckoutUrl(db(), bob, failed!.id);
    expect(first.url).toMatch(/\/dev\/checkout\//);
    // …and "Pay now", a second click and the Owner's resend all reuse it.
    const again = await payForMyBooking(db(), bob, r.bookingId);
    expect(again.url).toBe(first.url);
    mail.sent.length = 0;
    await resendPayLink(db(), owner, r.bookingId);
    const open = (await attemptsFor(r.bookingId)).filter((a) => a.status === 'open');
    expect(open).toHaveLength(1);
    const resent = mail.sent.find((m) => m.to === bob.email && m.template === 'booking.request-approved')!;
    expect(resent.text).toContain(`/api/payments/pay/${open[0]!.id}`);
    expect(resent.text).not.toMatch(/unreachable|provider|error/i);
    expect((await bookingsMissingPayLink(db(), owner)).some((m) => m.bookingId === r.bookingId)).toBe(false);
    await expect(resendPayLink(db(), bob, r.bookingId)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(payForMyBooking(db(), alice, r.bookingId)).rejects.toBeInstanceOf(NotFoundError);
    await payOpenCheckouts(db());
    expect((await rowsOf(r.bookingId))[0]!.status).toBe('confirmed');
  });

  it('the Owner resend creates the missing link; simultaneous clicks make one checkout', async () => {
    const r = await approvedWith(3, bob, await onboardedDog(bob, 'Twin'));
    const both = await Promise.allSettled([
      payForMyBooking(db(), bob, r.bookingId),
      payForMyBooking(db(), bob, r.bookingId),
    ]);
    expect(both.some((b) => b.status === 'fulfilled')).toBe(true);
    mail.sent.length = 0;
    await resendPayLink(db(), owner, r.bookingId);
    expect((await attemptsFor(r.bookingId)).filter((a) => a.status === 'open')).toHaveLength(1);
    expect(mail.sent.some((m) => m.to === bob.email && m.template === 'booking.request-approved')).toBe(true);
    await payOpenCheckouts(db());
  });

  it('a Pay now that loses the race is told the link is being prepared, not that it failed', async () => {
    const r = await approvedWith(3, bob, await onboardedDog(bob, 'Racer'));
    const real = simulated().createCheckout.bind(simulated());
    const slow = vi.spyOn(simulated(), 'createCheckout').mockImplementation(async (a) => {
      await new Promise((res) => setTimeout(res, 300));
      return real(a);
    });
    const both = await Promise.allSettled([
      payForMyBooking(db(), bob, r.bookingId),
      (async () => {
        await new Promise((res) => setTimeout(res, 100));
        return payForMyBooking(db(), bob, r.bookingId);
      })(),
    ]);
    slow.mockRestore();
    const lost = both.find((b) => b.status === 'rejected') as PromiseRejectedResult | undefined;
    // Either the second click reused the finished link, or it is told, accurately, to try again.
    if (lost) {
      expect(lost.reason).toBeInstanceOf(PayLinkBusyError);
      expect(lost.reason).not.toBeInstanceOf(PayLinkUnavailableError);
    }
    expect(both.some((b) => b.status === 'fulfilled')).toBe(true);
    expect((await attemptsFor(r.bookingId)).filter((a) => a.status === 'open')).toHaveLength(1);
    await payOpenCheckouts(db());
  });

  it('an unpaid hold with no link lapses at its deadline', async () => {
    const r = await approvedWith(3, bob, await onboardedDog(bob, 'Lapse'));
    const [row] = await rowsOf(r.bookingId);
    mail.sent.length = 0;
    await releaseExpiredCheckouts(db(), new Date(row!.offerExpiresAt!.getTime() + 1000));
    expect((await rowsOf(r.bookingId))[0]!.status).toBe('cancelled');
    expect(mail.sent.some((m) => m.to === bob.email)).toBe(true);
  });
});

describe('failed approvals (Developer 1 gap b)', () => {
  it('records why an approval failed, shows it to the Owner, and clears it once approved', async () => {
    const date = weekdayAhead(6);
    const moss = await onboardedDog(carol, 'Moss');
    const r = await createMyBookings(db(), carol, { dogIds: [moss], dates: [date], session: 'full', taxi: false });
    const kc = and(
      eq(complianceSubmissions.dogId, moss),
      eq(complianceSubmissions.requirementKey, 'vaccination_kennel_cough'),
    );
    const [before] = await db().select().from(complianceSubmissions).where(kc);
    await db()
      .update(complianceSubmissions)
      .set({ expiresOn: addDays(date, -1) })
      .where(kc);
    await expect(approveApprovalRequest(db(), owner, r.requestId!)).rejects.toBeInstanceOf(ConflictError);
    const listed = (await ownerApprovalList(db(), owner)).find((i) => i.id === r.requestId)!;
    expect(listed.status).toBe('pending');
    expect(listed.lastError).toMatch(/Moss on .*runs out before this date/);
    expect(listed.lastErrorAt).toBeInstanceOf(Date);
    // Customers never see it.
    const mine = (await myApprovalRequests(db(), carol)).find((i) => i.id === r.requestId)!;
    expect(mine).not.toHaveProperty('lastError');

    await db().update(complianceSubmissions).set({ expiresOn: before!.expiresOn }).where(kc);
    await approveApprovalRequest(db(), owner, r.requestId!);
    const [row] = await db().select().from(approvalRequests).where(eq(approvalRequests.id, r.requestId!));
    expect(row!.status).toBe('approved');
    expect(row!.lastError).toBeNull();
  });
});

describe('manual waitlist (D81, D82)', () => {
  it('Give place makes its own booking with a pay link; nothing is automatic', async () => {
    const date = weekdayAhead(30);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 1, taxiCapacity: 20 });
    const a = await createMyBookings(db(), alice, { dogIds: [aliceDog], dates: [date], session: 'full', taxi: false });
    const w = await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [date], session: 'full', taxi: false });
    const waiting = await rowOf(bobDog, date);
    expect(waiting.status).toBe('waitlisted');
    await expect(giveWaitlistPlace(db(), owner, waiting.id, { version: waiting.version })).rejects.toThrow(
      /no free place/,
    );
    // The day view says so up front, so the button can be disabled with a reason.
    const full = (await ownerDay(db(), owner, date)).waitlist.find((r) => r.id === waiting.id)!;
    expect(full.giveBlock).toMatch(/no free place/);
    await withdrawMyApprovalRequest(db(), alice, a.requestId!);
    await runTick(db(), system);
    expect((await ownerDay(db(), owner, date)).waitlist.find((r) => r.id === waiting.id)!.giveBlock).toBeNull();
    expect((await rowOf(bobDog, date)).status).toBe('waitlisted');
    mail.sent.length = 0;
    const g = await giveWaitlistPlace(db(), owner, waiting.id, { version: waiting.version });
    const given = await rowOf(bobDog, date);
    expect(given.status).toBe('pending_payment');
    expect(given.bookingId).toBe(g.bookingId);
    expect(given.bookingId).not.toBe(w.bookingId);
    expect(mail.sent.some((m) => m.to === bob.email && m.template === 'payment.link')).toBe(true);
    await payOpenCheckouts(db());
    expect((await rowOf(bobDog, date)).status).toBe('confirmed');
    await expect(giveWaitlistPlace(db(), alice, waiting.id, { version: 1 })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('Give place blocks a dog failing the vaccination check up front, with the reason (D82)', async () => {
    const date = weekdayAhead(7);
    const pip = await onboardedDog(bob, 'Pip');
    await setDayCapacity(db(), owner, { date, sessionCapacity: 0, taxiCapacity: 20 });
    await createMyBookings(db(), bob, { dogIds: [pip], dates: [date], session: 'full', taxi: false });
    const waiting = await rowOf(pip, date);
    expect(waiting.status).toBe('waitlisted');
    // The kennel cough cover now runs out the day before; a place frees up.
    await db()
      .update(complianceSubmissions)
      .set({ expiresOn: addDays(date, -1) })
      .where(
        and(eq(complianceSubmissions.dogId, pip), eq(complianceSubmissions.requirementKey, 'vaccination_kennel_cough')),
      );
    await setDayCapacity(db(), owner, { date, sessionCapacity: 5, taxiCapacity: 20 });

    const day = await ownerDay(db(), owner, date);
    const listed = day.waitlist.find((r) => r.id === waiting.id)!;
    expect(listed.giveBlock).toMatch(/^Can’t give a place: .*runs out before this date/);

    mail.sent.length = 0;
    const auditBefore = await db().execute(
      sql`select count(*)::int as n from audit_events where entity_id = ${waiting.id}`,
    );
    await expect(giveWaitlistPlace(db(), owner, waiting.id, { version: waiting.version })).rejects.toThrow(
      /Can’t give Pip a place: .*runs out before this date/,
    );
    const after = await rowOf(pip, date);
    expect(after.status).toBe('waitlisted');
    expect(after.version).toBe(waiting.version);
    expect(after.bookingId).toBe(waiting.bookingId);
    expect(mail.sent).toHaveLength(0);
    const auditAfter = await db().execute(
      sql`select count(*)::int as n from audit_events where entity_id = ${waiting.id}`,
    );
    expect(auditAfter.rows[0]).toEqual(auditBefore.rows[0]);
  });

  it('membership waitlist places are confirmed straight away', async () => {
    const date = weekdayAhead(31);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 0, taxiCapacity: 20 });
    await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [date], session: 'full', taxi: false });
    const waiting = await rowOf(bobDog, date);
    await db()
      .update(bookingDogs)
      .set({ kind: 'membership', membershipId: await membershipFor(bob, bobDog) })
      .where(eq(bookingDogs.id, waiting.id));
    await setDayCapacity(db(), owner, { date, sessionCapacity: 5, taxiCapacity: 20 });
    await giveWaitlistPlace(db(), owner, waiting.id, { version: waiting.version });
    expect((await rowOf(bobDog, date)).status).toBe('confirmed');
  });

  it('customers leave the waitlist at any time; the Owner can remove them', async () => {
    const date = weekdayAhead(32);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 0, taxiCapacity: 20 });
    await createMyBookings(db(), alice, { dogIds: [aliceDog, aliceDog2], dates: [date], session: 'full', taxi: false });
    const one = await rowOf(aliceDog, date);
    await expect(leaveWaitlist(db(), bob, one.id)).rejects.toBeInstanceOf(NotFoundError);
    await leaveWaitlist(db(), alice, one.id);
    expect((await rowOf(aliceDog, date)).status).toBe('cancelled');
    const two = await rowOf(aliceDog2, date);
    await ownerCancel(db(), owner, two.id, { version: two.version, reason: 'Day is fully staffed', charge: 'on' });
    const removed = await rowOf(aliceDog2, date);
    expect(removed.status).toBe('cancelled');
    expect(removed.lateCancellation).toBe(false);
    const list = await myBookings(db(), alice);
    expect(JSON.stringify(list)).not.toContain('fully staffed');
  });
});

describe('approvals authorisation', () => {
  it('only the Owner decides; customers only see their own requests', async () => {
    const d = weekdayAhead(34);
    const r = await createMyBookings(db(), bob, { dogIds: [bobDog], dates: [d], session: 'am', taxi: false });
    await expect(approveApprovalRequest(db(), bob, r.requestId!)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(rejectApprovalRequest(db(), alice, r.requestId!)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(ownerApprovalList(db(), alice)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(pendingApprovalCount(db(), bob)).rejects.toBeInstanceOf(AuthorizationError);
    expect((await myApprovalRequests(db(), alice, { status: 'all' })).some((x) => x.id === r.requestId)).toBe(false);
    const n = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from approval_requests where status = 'pending'`,
    );
    expect(n.rows[0]!.n).toBeGreaterThan(0);
    await withdrawMyApprovalRequest(db(), bob, r.requestId!);
  });
});
