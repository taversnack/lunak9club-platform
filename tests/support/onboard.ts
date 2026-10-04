import { and, eq, sql } from 'drizzle-orm';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Db } from '../../src/infra/db/client';
import { complianceSubmissions, dogs } from '../../src/infra/db/schema';
import { FsStorageProvider } from '../../src/infra/storage/fs';
import { addMyContact, updateMyProfile } from '../../src/server/services/customers';
import { createMyDog, saveMyDogVet, submitMyOnboardingForm } from '../../src/server/services/dogs';
import { uploadVaccinationRecord } from '../../src/server/services/documents';
import { recordAssessment, reviewSubmission, setDogStatus } from '../../src/server/services/owner-review';
import { acceptTerms, myTermsStatus } from '../../src/server/services/policies';
import { addDays, londonDate } from '../../src/domain/time';
import { PDF, validDog, validOnboarding, type TestUser } from './factories';

const storage = new FsStorageProvider(mkdtempSync(join(tmpdir(), 'lunak9-onboard-')));

export async function readyCustomer(db: Db, u: TestUser) {
  await updateMyProfile(db, u, {
    phone: '07700900123',
    addressLine1: '1 High St',
    town: 'Guildford',
    postcode: 'GU1 4AB',
  });
  await addMyContact(db, u, { name: 'Em Contact', phone: '07700900555', isEmergencyContact: 'on' });
  const t = await myTermsStatus(db, u);
  await acceptTerms(db, u, t.terms!.id);
}

/** Fully onboard and approve a dog. */
export async function approvedDog(db: Db, owner: TestUser, user: TestUser, name: string) {
  const today = londonDate(new Date());
  const id = await createMyDog(db, user, { ...validDog, name });
  await saveMyDogVet(db, user, id, { practiceName: 'Vets', phone: '01483000000', agreedVet: 'same' });
  await submitMyOnboardingForm(db, user, id, validOnboarding);
  await uploadVaccinationRecord(db, storage, user, {
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
  const subs = await db
    .select()
    .from(complianceSubmissions)
    .where(and(eq(complianceSubmissions.dogId, id), eq(complianceSubmissions.status, 'pending_review')));
  for (const s of subs)
    await reviewSubmission(db, owner, s.id, { decision: 'approve', expiresOn: s.expiresOn, version: s.version });
  await recordAssessment(db, owner, id, { kind: 'meet_and_greet', outcome: 'passed', assessedOn: today });
  await recordAssessment(db, owner, id, { kind: 'trial_day', outcome: 'passed', assessedOn: today });
  const [d] = await db.select().from(dogs).where(eq(dogs.id, id));
  await setDogStatus(db, owner, id, { status: 'approved', version: d!.version });
  return id;
}

/**
 * Test clean-up: end every membership and free its booked days so later test files see empty
 * days (membership days are booked 60 days ahead and would otherwise use up capacity).
 */
export async function releaseMemberDays(db: Db) {
  await db.execute(
    sql`update booking_dogs set status = 'cancelled', cancelled_at = now(), late_cancellation = false where kind = 'membership' and status in ('confirmed', 'waitlisted', 'offered')`,
  );
  await db.execute(sql`update memberships set status = 'ended' where status in ('active', 'requested')`);
}

/** Upload and approve vaccination records for a dog (one record covering `keys`). */
export async function approveVaccinations(
  db: Db,
  owner: TestUser,
  user: TestUser,
  dogId: string,
  keys: string[],
  opts: { expiresOn?: string; primaryCourseCompletedOn?: string } = {},
) {
  const expiresOn = opts.expiresOn ?? addDays(londonDate(new Date()), 200);
  await uploadVaccinationRecord(db, storage, user, {
    dogId,
    fileName: 'v.pdf',
    bytes: PDF,
    firstCourse: opts.primaryCourseCompletedOn ? 'yes' : 'no',
    primaryCourseCompletedOn: opts.primaryCourseCompletedOn,
    // Date given (D68) is separate from the first-course date (D74); use the course end, or today.
    entries: keys.map((k) => ({
      requirementKey: k,
      expiresOn,
      administeredOn: opts.primaryCourseCompletedOn ?? londonDate(new Date()),
    })),
  });
  const subs = await db
    .select()
    .from(complianceSubmissions)
    .where(and(eq(complianceSubmissions.dogId, dogId), eq(complianceSubmissions.status, 'pending_review')));
  for (const s of subs)
    await reviewSubmission(db, owner, s.id, { decision: 'approve', expiresOn: s.expiresOn, version: s.version });
}
