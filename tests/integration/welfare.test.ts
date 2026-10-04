import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, like, sql } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { FsStorageProvider } from '@/infra/storage/fs';
import {
  accounts,
  bookingDogs,
  complianceSubmissions,
  customers,
  dataRequests,
  documents,
  dogs,
  incidents,
  notificationLog,
  users,
  welfareChecks,
} from '@/infra/db/schema';
import { createMyBookings } from '@/server/services/bookings';
import {
  acknowledgeIncident,
  addIncidentUpdate,
  myDogWelfare,
  myIncident,
  recordWelfareCheck,
  reportIncident,
  setIncidentStatus,
  setWelfareShared,
} from '@/server/services/welfare';
import { sendBookingReminders, sendOfferWarnings, sendVaccinationReminders } from '@/server/services/reminders';
import { decideErasure, exportMyData, myDataRequests, requestErasure, runRetention } from '@/server/services/privacy';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { AuthorizationError } from '@/server/policy/authorize';
import { isoWeekday } from '@/domain/booking/rules';
import { addDays, londonDate, londonInstant } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, PNG, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer } from '../support/onboard';
import { payOpenCheckouts } from '../support/payments';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const storage = new FsStorageProvider(mkdtempSync(join(tmpdir(), 'lunak9-welfare-')));
const system = { kind: 'system', job: 'test' } as const;
const today = londonDate(new Date());
const used = new Set<string>();
function weekdayAhead(n: number): string {
  let d = addDays(today, n);
  while (isoWeekday(d) > 5 || ['2026-12-25', '2026-12-28', '2027-01-01'].includes(d) || used.has(d)) d = addDays(d, 1);
  used.add(d);
  return d;
}

/** Database errors arrive wrapped by Drizzle; the trigger's message is on the cause. */
async function failsWith(p: PromiseLike<unknown>, re: RegExp) {
  const err = (await Promise.resolve(p).then(
    () => null,
    (e: unknown) => e,
  )) as (Error & { cause?: Error }) | null;
  expect(err, 'expected the database to refuse').not.toBeNull();
  expect(`${err?.message} ${err?.cause?.message ?? ''}`).toMatch(re);
}

let owner: TestUser;
let rosa: TestUser;
let sam: TestUser;
let rosaDog: string;
let samDog: string;

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Opal Owner');
  rosa = await makeUser(db(), 'customer', 'Rosa Records');
  sam = await makeUser(db(), 'customer', 'Sam Second');
  await readyCustomer(db(), rosa);
  await readyCustomer(db(), sam);
  rosaDog = await approvedDog(db(), owner, rosa, 'Clover');
  samDog = await approvedDog(db(), owner, sam, 'Pippin');
});
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

describe('vaccination reminders (D11, D66)', () => {
  it('reminds once per threshold, never naming the vaccination, then once on expiry', async () => {
    const [sub] = await db()
      .select()
      .from(complianceSubmissions)
      .where(and(eq(complianceSubmissions.dogId, rosaDog), eq(complianceSubmissions.status, 'approved')));
    const expiry = sub!.expiresOn;
    const tenDaysBefore = londonInstant(addDays(expiry, -10), '09:00');
    mail.sent.length = 0;
    await sendVaccinationReminders(db(), system, tenDaysBefore);
    const mine = () => mail.sent.filter((m) => m.to === rosa.email && m.template.startsWith('compliance.vaccination'));
    expect(mine()).toHaveLength(3); // core, leptospirosis, kennel cough – all at the 14-day reminder
    expect(mine()[0]!.text).not.toMatch(/leptospirosis|kennel|core/i);
    await sendVaccinationReminders(db(), system, tenDaysBefore);
    expect(mine()).toHaveLength(3);
    const keys = await db()
      .select()
      .from(notificationLog)
      .where(like(notificationLog.key, `vaccination:${rosaDog}:%`));
    expect(keys.every((k) => k.key.endsWith(':14'))).toBe(true);

    mail.sent.length = 0;
    await sendVaccinationReminders(db(), system, londonInstant(addDays(expiry, 1), '09:00'));
    expect(mine().map((m) => m.template)).toEqual(Array(3).fill('compliance.vaccination-expired'));
    expect(mail.sent.some((m) => m.to === owner.email && m.subject.includes('expired'))).toBe(true);
    await expect(sendVaccinationReminders(db(), rosa, new Date())).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('booking and offer reminders (D67)', () => {
  it('emails the day before at 17:00, once', async () => {
    const date = weekdayAhead(50);
    await createMyBookings(db(), sam, { dogIds: [samDog], dates: [date], session: 'full', taxi: true });
    await payOpenCheckouts(db());
    const evening = londonInstant(addDays(date, -1), '17:05');
    mail.sent.length = 0;
    await sendBookingReminders(db(), system, evening);
    await sendBookingReminders(db(), system, evening);
    const r = mail.sent.filter((m) => m.to === sam.email && m.template === 'booking.reminder');
    expect(r).toHaveLength(1);
    expect(r[0]!.text).toContain('Pippin');
  });

  it('warns when a place offer has under 2 hours left, once', async () => {
    const date = weekdayAhead(51);
    const expires = new Date(Date.now() + 90 * 60_000);
    const [b] = (
      await db().execute<{ id: string }>(
        sql`insert into bookings (customer_id, created_by, source) select customer_id, ${sam.userId}, 'customer' from dogs where id = ${samDog} returning id`,
      )
    ).rows;
    await db().execute(sql`insert into service_days (service_date) values (${date}) on conflict do nothing`);
    await db().execute(
      sql`insert into booking_dogs (booking_id, customer_id, dog_id, service_date, session, status, offer_expires_at) select ${b!.id}, customer_id, id, ${date}, 'am', 'offered', ${expires} from dogs where id = ${samDog}`,
    );
    mail.sent.length = 0;
    await sendOfferWarnings(db(), system);
    await sendOfferWarnings(db(), system);
    expect(mail.sent.filter((m) => m.template === 'booking.offer-lapsing' && m.to === sam.email)).toHaveLength(1);
  });
});

describe('incident reports (D62)', () => {
  let incidentId: string;

  it('only the Owner can report; the customer is always told, without details in the email', async () => {
    const input = {
      dogId: rosaDog,
      occurredOn: today,
      occurredTime: '00:01',
      kind: 'injury',
      severity: 'minor',
      description: 'Small graze on the left front paw during play.',
      actionTaken: 'Cleaned with saline and monitored.',
      internalNotes: 'Play group was a bit busy – split it next time.',
    };
    await expect(reportIncident(db(), storage, rosa, input)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(reportIncident(db(), storage, owner, { ...input, vetContacted: 'on' })).rejects.toBeInstanceOf(
      ValidationError,
    ); // vet advice needed
    mail.sent.length = 0;
    incidentId = await reportIncident(db(), storage, owner, input, [{ fileName: 'paw.png', bytes: PNG }]);
    const email = mail.sent.find((m) => m.template === 'welfare.incident');
    expect(email?.to).toBe(rosa.email);
    expect(email?.text).not.toMatch(/graze|paw|saline/i);
    const [row] = await db().select().from(incidents).where(eq(incidents.id, incidentId));
    expect(row!.customerNotifiedAt).not.toBeNull();
  });

  it('the customer sees the report and photos but never internal notes; nobody else can see it', async () => {
    const d = await myIncident(db(), rosa, incidentId);
    expect(d.inc.description).toContain('graze');
    expect(d.inc.internalNotes).toBeNull();
    expect(d.photos).toHaveLength(1);
    await expect(myIncident(db(), sam, incidentId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('the original report is locked; updates are appended (private ones stay private)', async () => {
    await failsWith(
      db().update(incidents).set({ description: 'Nothing happened' }).where(eq(incidents.id, incidentId)),
      /locked/,
    );
    await failsWith(db().delete(incidents).where(eq(incidents.id, incidentId)), /retention/);
    mail.sent.length = 0;
    await addIncidentUpdate(db(), owner, incidentId, { body: 'Note to self: check the gate latch.', private: 'on' });
    expect(mail.sent).toHaveLength(0);
    await addIncidentUpdate(db(), owner, incidentId, { body: 'Paw looked fine at pick-up.' });
    expect(mail.sent.map((m) => m.template)).toEqual(['welfare.incident-update']);
    const d = await myIncident(db(), rosa, incidentId);
    expect(d.updates.map((u) => u.body)).toEqual(['Paw looked fine at pick-up.']);
  });

  it('the customer acknowledges it; the Owner closes it', async () => {
    await acknowledgeIncident(db(), rosa, incidentId);
    await setIncidentStatus(db(), owner, incidentId, true);
    await expect(setIncidentStatus(db(), owner, incidentId, true)).rejects.toBeInstanceOf(ConflictError);
    const [row] = await db().select().from(incidents).where(eq(incidents.id, incidentId));
    expect(row).toMatchObject({ status: 'closed' });
    expect(row!.acknowledgedAt).not.toBeNull();
  });
});

describe('daily welfare checks (D63)', () => {
  const base = { serviceDate: today, ate: 'all', toileting: 'normal', mood: 'happy' };

  it('are private unless shared', async () => {
    const r = await recordWelfareCheck(db(), owner, {
      ...base,
      dogId: rosaDog,
      drinking: 'normal',
      note: 'Lovely day.',
    });
    expect(r).toMatchObject({ shared: false, autoShared: false });
    expect((await myDogWelfare(db(), rosa, rosaDog)).find((n) => n.id === r.id)).toBeUndefined();
    await setWelfareShared(db(), owner, r.id, true);
    expect((await myDogWelfare(db(), rosa, rosaDog)).find((n) => n.id === r.id)?.note).toBe('Lovely day.');
    await expect(myDogWelfare(db(), sam, rosaDog)).resolves.toEqual([]);
  });

  it('anything the owner must be told about is shared and emailed automatically, and stays shared', async () => {
    mail.sent.length = 0;
    const r = await recordWelfareCheck(db(), owner, {
      ...base,
      dogId: rosaDog,
      drinking: 'less',
      concerns: ['anxiety'],
    });
    expect(r).toMatchObject({ shared: true, autoShared: true, concerns: ['anxiety', 'drinking_less'] });
    expect(mail.sent.map((m) => m.template)).toEqual(['welfare.note']);
    expect(mail.sent[0]!.text).not.toMatch(/anxi|drink/i);
    await expect(setWelfareShared(db(), owner, r.id, false)).rejects.toBeInstanceOf(ConflictError);
    await failsWith(db().update(welfareChecks).set({ note: 'edited' }).where(eq(welfareChecks.id, r.id)), /locked/);
    await expect(
      recordWelfareCheck(db(), rosa, { ...base, dogId: rosaDog, drinking: 'normal' }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('your data (UK GDPR, D65)', () => {
  it('a customer can download only their own data', async () => {
    const data = await exportMyData(db(), rosa);
    expect(data.account?.email).toBe(rosa.email);
    expect(data.dogs.map((d) => d.name)).toEqual(['Clover']);
    expect(data.incidentReports).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('Pippin');
    expect(JSON.stringify(data)).not.toContain('split it next time'); // internal notes never exported
  });

  it('erasure: blocked by upcoming bookings, then closes the account and anonymises when due', async () => {
    await requestErasure(db(), sam, { reason: 'Moving away' });
    await expect(requestErasure(db(), sam, {})).rejects.toBeInstanceOf(ConflictError);
    const [req] = await myDataRequests(db(), sam);
    await expect(decideErasure(db(), storage, owner, req!.id, true, {})).rejects.toThrow(/upcoming booking/);
    await expect(decideErasure(db(), storage, sam, req!.id, true, {})).rejects.toBeInstanceOf(AuthorizationError);
    await db()
      .update(bookingDogs)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(bookingDogs.dogId, samDog));
    mail.sent.length = 0;
    const r = await decideErasure(db(), storage, owner, req!.id, true, {});
    expect(r.completed).toBe(false); // joined today → kept 3 years for the licence register
    expect(mail.sent.find((m) => m.template === 'data.erasure-approved')?.to).toBe(sam.email);
    const [u] = await db().select().from(users).where(eq(users.id, sam.userId));
    expect(u!.email).toMatch(/^erased-.*@invalid\.lunak9club\.test$/);
    expect(await db().select().from(accounts).where(eq(accounts.userId, sam.userId))).toHaveLength(0);
    const [cust] = await db().select().from(customers).where(eq(customers.userId, sam.userId));
    expect(cust!.anonymisedAt).toBeNull();
    expect(cust!.phone).not.toBeNull();

    // When the retention date arrives, the daily job removes the rest. (Bring the date forward
    // rather than moving the clock, so other records created by this test run aren't affected.)
    await db()
      .update(dataRequests)
      .set({ retainUntil: addDays(today, -1) })
      .where(eq(dataRequests.id, req!.id));
    await runRetention(db(), storage, system);
    const [after] = await db().select().from(customers).where(eq(customers.id, cust!.id));
    expect(after!.anonymisedAt).not.toBeNull();
    expect(after!.phone).toBeNull();
    const [dog] = await db().select().from(dogs).where(eq(dogs.id, samDog));
    expect(dog!.name).toBe('Former dog');
    const [done] = await db().select().from(dataRequests).where(eq(dataRequests.id, req!.id));
    expect(done!.status).toBe('completed');
    const [u2] = await db().select().from(users).where(eq(users.id, sam.userId));
    expect(u2!.name).toBe('Former customer');
  });
});

describe('retention schedule (D64)', () => {
  it('deletes licence records after 3 years (with their files) and nothing newer', async () => {
    const [cust] = await db().select().from(customers).where(eq(customers.userId, rosa.userId));
    const fourYearsAgo = new Date(Date.now() - 4 * 365 * 86_400_000);
    const [oldCheck] = await db()
      .insert(welfareChecks)
      .values({
        dogId: rosaDog,
        serviceDate: londonDate(fourYearsAgo),
        ate: 'all',
        drinking: 'normal',
        toileting: 'normal',
        mood: 'happy',
        createdAt: fourYearsAgo,
      })
      .returning();
    const key = `test/old-incident-${Date.now()}`;
    await storage.put(key, PNG, 'image/png');
    const [doc] = await db()
      .insert(documents)
      .values({
        customerId: cust!.id,
        dogId: rosaDog,
        storageKey: key,
        displayName: 'old.png',
        contentType: 'image/png',
        sizeBytes: PNG.byteLength,
        sha256: 'x',
        uploadedBy: owner.userId,
        purpose: 'incident',
        uploadedAt: fourYearsAgo,
      })
      .returning();
    const [oldInc] = await db()
      .insert(incidents)
      .values({
        dogId: rosaDog,
        customerId: cust!.id,
        occurredAt: fourYearsAgo,
        kind: 'other',
        severity: 'minor',
        description: 'Old',
        actionTaken: 'Old',
        status: 'closed',
        closedAt: fourYearsAgo,
        createdAt: fourYearsAgo,
      })
      .returning();
    await db().execute(sql`insert into incident_photos (incident_id, document_id) values (${oldInc!.id}, ${doc!.id})`);

    const r = await runRetention(db(), storage, system);
    expect(r.welfareChecks).toBeGreaterThanOrEqual(1);
    expect(r.incidents).toBeGreaterThanOrEqual(1);
    expect(await db().select().from(welfareChecks).where(eq(welfareChecks.id, oldCheck!.id))).toHaveLength(0);
    expect(await db().select().from(incidents).where(eq(incidents.id, oldInc!.id))).toHaveLength(0);
    expect(await db().select().from(documents).where(eq(documents.id, doc!.id))).toHaveLength(0);
    await expect(storage.get(key)).rejects.toThrow();
    // This year's incident and checks are untouched.
    expect((await db().select().from(incidents).where(eq(incidents.dogId, rosaDog))).length).toBe(1);
    expect((await db().select().from(welfareChecks).where(eq(welfareChecks.dogId, rosaDog))).length).toBe(2);
  });
});
