import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../src/infra/db/client';
import {
  assessments,
  complianceSubmissions,
  contacts,
  customers,
  documents,
  dogBehaviourProfiles,
  dogHealthProfiles,
  dogPermissions,
  dogs,
  policyAcknowledgements,
  policyVersions,
  vets,
} from '../../src/infra/db/schema';
import { getStorage } from '../../src/infra/storage';
import { addDays, londonDate } from '../../src/domain/time';

const DEMO_PDF = new TextEncoder().encode('%PDF-1.4\n% LunaK9 Club demo vaccination record (fictional)\n%%EOF\n');

/**
 * Give a demo customer a fully onboarded, approved dog so bookings can be tried straight away.
 * Idempotent: does nothing if the customer already has a dog with this name. All data is fictional.
 */
export async function ensureApprovedDemoDog(
  db: Db,
  userId: string,
  ownerUserId: string,
  dogName: string,
  breed: string,
) {
  await db.insert(customers).values({ userId }).onConflictDoNothing();
  const [customer] = await db.select().from(customers).where(eq(customers.userId, userId));
  if (!customer) throw new Error('customer missing');
  const [existing] = await db
    .select({ id: dogs.id })
    .from(dogs)
    .where(and(eq(dogs.customerId, customer.id), eq(dogs.name, dogName)));
  if (existing) return existing.id;

  await db
    .update(customers)
    .set({ phone: '07700900000', addressLine1: '1 Demo Lane', town: 'Guildford', postcode: 'GU1 1AA' })
    .where(eq(customers.id, customer.id));
  const hasContact = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.customerId, customer.id));
  if (!hasContact.length) {
    await db.insert(contacts).values({
      customerId: customer.id,
      name: 'Demo Emergency Contact',
      phone: '07700900001',
      isEmergencyContact: true,
      isAuthorisedCollector: true,
    });
  }
  const [terms] = await db
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policyKey, 'terms'))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  if (terms)
    await db.insert(policyAcknowledgements).values({ userId, policyVersionId: terms.id }).onConflictDoNothing();

  const [vet] = await db
    .insert(vets)
    .values({ customerId: customer.id, practiceName: 'Demo Vets', phone: '01483000000' })
    .returning({ id: vets.id });
  const [dog] = await db
    .insert(dogs)
    .values({
      customerId: customer.id,
      name: dogName,
      breed,
      sex: 'female',
      dateOfBirth: '2021-04-01',
      weightKg: 12,
      microchipNumber: '826000000000999',
      neutered: true,
      vetId: vet!.id,
      onboardingSubmittedAt: new Date(),
      status: 'approved',
      approvedAt: new Date(),
      approvedBy: ownerUserId,
    })
    .returning({ id: dogs.id });
  const dogId = dog!.id;
  await db.insert(dogHealthProfiles).values({ dogId, fleaAndWorming: 'Monthly (demo)' });
  await db.insert(dogBehaviourProfiles).values({ dogId, temperament: 'Friendly (demo)', biteHistory: false });
  await db
    .insert(dogPermissions)
    .values({ dogId, transport: true, photosAndSocialMedia: false, emergencyVetTreatment: true });

  const key = `customers/${customer.id}/dogs/${dogId}/${randomUUID()}`;
  await getStorage().put(key, DEMO_PDF, 'application/pdf');
  const [doc] = await db
    .insert(documents)
    .values({
      customerId: customer.id,
      dogId,
      storageKey: key,
      displayName: 'demo-vaccination-record.pdf',
      contentType: 'application/pdf',
      sizeBytes: DEMO_PDF.byteLength,
      sha256: createHash('sha256').update(DEMO_PDF).digest('hex'),
      uploadedBy: userId,
    })
    .returning({ id: documents.id });
  const expiresOn = addDays(londonDate(new Date()), 300);
  for (const requirementKey of ['vaccination_core', 'vaccination_leptospirosis', 'vaccination_kennel_cough']) {
    await db.insert(complianceSubmissions).values({
      dogId,
      requirementKey,
      documentId: doc!.id,
      status: 'approved',
      expiresOn,
      submittedBy: userId,
      reviewedBy: ownerUserId,
      reviewedAt: new Date(),
    });
  }
  for (const kind of ['meet_and_greet', 'trial_day'] as const) {
    await db
      .insert(assessments)
      .values({ dogId, kind, outcome: 'passed', assessedOn: londonDate(new Date()), recordedBy: ownerUserId });
  }
  return dogId;
}
