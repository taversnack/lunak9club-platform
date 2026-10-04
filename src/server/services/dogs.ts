import 'server-only';
import { and, asc, eq, isNull, desc, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import {
  complianceSubmissions,
  customers,
  documents,
  dogBehaviourProfiles,
  dogHealthProfiles,
  dogPermissions,
  dogs,
  vets,
} from '@/infra/db/schema';
import { assertAuthorized, type Actor } from '../policy/authorize';
import type { Permission } from '../policy/permissions';
import { recordAudit } from '../audit';
import { NotFoundError } from '../errors';
import { idOrNotFound, isoDate, parseInput, requiredText } from '../validation';
import { asUser, getMyCustomer } from './customers';
import { evaluateDogs } from './compliance-facts';
import { onboardingInput, VetInput } from './dog-register-input';
import {
  consentUpdates,
  CONSENT_KEYS,
  registerGaps,
  type ConsentKey,
  type StoredConsent,
} from '@/domain/compliance/register';
import { londonDate } from '@/domain/time';

/**
 * Load one of the caller's own dogs. The lookup joins on the caller's user id, so another
 * customer's dog id behaves exactly like a dog that doesn't exist.
 */
export async function loadMyDog(db: Db, actor: Actor, rawDogId: string, permission: Permission = 'dogs.self.manage') {
  const me = asUser(actor);
  const dogId = idOrNotFound(rawDogId, 'Dog');
  const [row] = await db
    .select({ dog: dogs, userId: customers.userId })
    .from(dogs)
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .where(and(eq(dogs.id, dogId), eq(customers.userId, me.userId), isNull(dogs.archivedAt)));
  if (!row) throw new NotFoundError('Dog');
  assertAuthorized(me, permission, { ownerUserId: row.userId });
  return row.dog;
}

export async function listMyDogs(db: Db, actor: Actor) {
  const customer = await getMyCustomer(db, actor);
  const rows = await db
    .select({ id: dogs.id, name: dogs.name, breed: dogs.breed, status: dogs.status })
    .from(dogs)
    .where(and(eq(dogs.customerId, customer.id), isNull(dogs.archivedAt)))
    .orderBy(asc(dogs.createdAt));
  const evals = await evaluateDogs(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, evaluation: evals.get(r.id)! }));
}

const sex = z.enum(['female', 'male'], { message: 'Choose female or male' });

export const DogDetailsInput = z.object({
  name: requiredText('your dog’s name', 60),
  breed: requiredText('the breed (or “cross breed”)', 80),
  sex,
  dateOfBirth: isoDate('the date of birth'),
  weightKg: z.coerce
    .number({ message: 'Enter the weight in kilograms' })
    .gt(0, 'Enter the weight in kilograms')
    .lt(150, 'Check the weight'),
  microchipNumber: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s+/g, ''))
    .refine((v) => /^\d{9,15}$/.test(v), 'Enter the microchip number (usually 15 digits)'),
  neutered: z.enum(['yes', 'no'], { message: 'Tell us if your dog is neutered' }).transform((v) => v === 'yes'),
});

export async function createMyDog(db: Db, actor: Actor, input: unknown): Promise<string> {
  const data = parseInput(DogDetailsInput, input);
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'dogs.self.manage', { ownerUserId: customer.userId });
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dogs)
      .values({ ...data, customerId: customer.id })
      .returning({ id: dogs.id });
    await recordAudit(tx, { actor: me, action: 'dog.created', entityType: 'dog', entityId: row!.id });
    return row!.id;
  });
}

export async function updateMyDogDetails(db: Db, actor: Actor, dogId: string, input: unknown) {
  const data = parseInput(DogDetailsInput, input);
  const dog = await loadMyDog(db, actor, dogId);
  await db.transaction(async (tx) => {
    await tx
      .update(dogs)
      .set({ ...data, version: dog.version + 1 })
      .where(eq(dogs.id, dog.id));
    await recordAudit(tx, { actor, action: 'dog.details_updated', entityType: 'dog', entityId: dog.id });
  });
}

export { VetInput };

/**
 * Save the dog's usual vet and the vet agreed for emergencies (licence guidance 9.8, D70).
 * The agreed vet is either the usual vet (same row) or a separate practice row for this dog.
 * `vetAgreedAt` changes only when the agreed practice changes (choice, name or phone).
 */
export async function saveMyDogVet(db: Db, actor: Actor, dogId: string, input: unknown, now = new Date()) {
  const { vet: data, agreed } = parseInput(VetInput, input);
  const dog = await loadMyDog(db, actor, dogId);
  await db.transaction(async (tx) => {
    // The practice agreed before this save (if any), read before anything is changed.
    const [before] = dog.agreedVetId
      ? await tx
          .select()
          .from(vets)
          .where(and(eq(vets.id, dog.agreedVetId), eq(vets.customerId, dog.customerId)))
      : [];
    const separate = before && before.id !== dog.vetId ? before : null;

    let vetId = dog.vetId;
    if (vetId) {
      await tx
        .update(vets)
        .set(data)
        .where(and(eq(vets.id, vetId), eq(vets.customerId, dog.customerId)));
    } else {
      const [v] = await tx
        .insert(vets)
        .values({ ...data, customerId: dog.customerId })
        .returning({ id: vets.id });
      vetId = v!.id;
    }

    let agreedVetId: string;
    let details: { practiceName: string; phone: string };
    if (agreed.kind === 'same') {
      agreedVetId = vetId;
      details = data;
    } else {
      details = { practiceName: agreed.practiceName, phone: agreed.phone };
      const values = { ...details, address: agreed.address };
      if (separate) {
        await tx.update(vets).set(values).where(eq(vets.id, separate.id));
        agreedVetId = separate.id;
      } else {
        const [v] = await tx
          .insert(vets)
          .values({ ...values, customerId: dog.customerId })
          .returning({ id: vets.id });
        agreedVetId = v!.id;
      }
    }
    const sameChoice = before ? (agreed.kind === 'same') === (before.id === dog.vetId) : false;
    const changed =
      !before ||
      !sameChoice ||
      before.practiceName !== details.practiceName ||
      before.phone !== details.phone ||
      !dog.vetAgreedAt;
    await tx
      .update(dogs)
      .set({ vetId, agreedVetId, ...(changed ? { vetAgreedAt: now } : {}) })
      .where(eq(dogs.id, dog.id));
    // A separate emergency practice no longer used by any dog is removed rather than left behind.
    if (separate && agreedVetId !== separate.id) {
      const [inUse] = await tx
        .select({ id: dogs.id })
        .from(dogs)
        .where(or(eq(dogs.vetId, separate.id), eq(dogs.agreedVetId, separate.id)))
        .limit(1);
      if (!inUse) await tx.delete(vets).where(eq(vets.id, separate.id));
    }
    await recordAudit(tx, { actor, action: 'dog.vet_saved', entityType: 'dog', entityId: dog.id });
  });
}

/**
 * Save the onboarding form (health, behaviour, permissions and licence register fields, D68–D69).
 * Sensitive: never logged, and audited without any of the answers.
 */
export async function submitMyOnboardingForm(db: Db, actor: Actor, dogId: string, input: unknown, now = new Date()) {
  const me = asUser(actor);
  const dog = await loadMyDog(db, me, dogId);
  const d = parseInput(onboardingInput({ today: londonDate(now), dateOfBirth: dog.dateOfBirth }), input);
  await db.transaction(async (tx) => {
    const health = {
      allergies: d.allergies,
      medication: d.medication,
      dietaryRequirements: d.dietaryRequirements,
      medicalConditions: d.medicalConditions,
      fleaAndWorming: d.fleaAndWorming,
      lastWormedOn: d.lastWormedOn,
      lastFleaTreatmentOn: d.lastFleaTreatmentOn,
      exerciseRestricted: d.exerciseRestricted,
      exerciseRestrictions: d.exerciseRestricted ? d.exerciseRestrictions : null,
      insured: d.insured,
      insurer: d.insured ? d.insurer : null,
      insurancePolicyNumber: d.insured ? d.insurancePolicyNumber : null,
    };
    const behaviour = {
      temperament: d.temperament,
      triggers: d.triggers,
      biteHistory: d.biteHistory,
      biteDetails: d.biteHistory ? d.biteDetails : null,
      handlingInstructions: d.handlingInstructions,
      emergencyInstructions: d.emergencyInstructions,
    };
    const [existing] = await tx.select().from(dogPermissions).where(eq(dogPermissions.dogId, dog.id)).for('update');
    const stored: Partial<Record<ConsentKey, StoredConsent>> = {};
    if (existing)
      for (const k of CONSENT_KEYS) stored[k] = { value: existing[k], at: existing[`${k}At`], by: existing[`${k}By`] };
    const answers: Partial<Record<ConsentKey, boolean>> = {};
    for (const k of CONSENT_KEYS) if (d[k] !== undefined) answers[k] = d[k];
    const perms = {
      transport: d.transport,
      photosAndSocialMedia: d.photosAndSocialMedia,
      emergencyVetTreatment: d.emergencyVetTreatment,
      ...consentUpdates(answers, stored, me.userId, now),
    };
    await tx
      .insert(dogHealthProfiles)
      .values({ dogId: dog.id, ...health })
      .onConflictDoUpdate({ target: dogHealthProfiles.dogId, set: health });
    await tx
      .insert(dogBehaviourProfiles)
      .values({ dogId: dog.id, ...behaviour })
      .onConflictDoUpdate({ target: dogBehaviourProfiles.dogId, set: behaviour });
    await tx
      .insert(dogPermissions)
      .values({ dogId: dog.id, ...perms })
      .onConflictDoUpdate({ target: dogPermissions.dogId, set: perms });
    await tx.update(dogs).set({ onboardingSubmittedAt: now }).where(eq(dogs.id, dog.id));
    await recordAudit(tx, { actor, action: 'dog.onboarding_submitted', entityType: 'dog', entityId: dog.id });
  });
}

/** Everything the customer sees about one of their own dogs. Internal Owner notes are never included. */
export async function getMyDog(db: Db, actor: Actor, dogId: string) {
  const dog = await loadMyDog(db, actor, dogId);
  const [health, behaviour, perms, vet, subs, evals] = await Promise.all([
    db.select().from(dogHealthProfiles).where(eq(dogHealthProfiles.dogId, dog.id)),
    db.select().from(dogBehaviourProfiles).where(eq(dogBehaviourProfiles.dogId, dog.id)),
    db.select().from(dogPermissions).where(eq(dogPermissions.dogId, dog.id)),
    dog.vetId ? db.select().from(vets).where(eq(vets.id, dog.vetId)) : Promise.resolve([]),
    db
      .select({
        id: complianceSubmissions.id,
        requirementKey: complianceSubmissions.requirementKey,
        status: complianceSubmissions.status,
        expiresOn: complianceSubmissions.expiresOn,
        administeredOn: complianceSubmissions.administeredOn,
        reviewReason: complianceSubmissions.reviewReason,
        submittedAt: complianceSubmissions.submittedAt,
        documentId: documents.id,
        documentName: documents.displayName,
      })
      .from(complianceSubmissions)
      .innerJoin(documents, eq(documents.id, complianceSubmissions.documentId))
      .where(eq(complianceSubmissions.dogId, dog.id))
      .orderBy(desc(complianceSubmissions.submittedAt)),
    evaluateDogs(db, [dog.id]),
  ]);
  const agreedVet =
    dog.agreedVetId && dog.agreedVetId !== dog.vetId
      ? ((await db.select().from(vets).where(eq(vets.id, dog.agreedVetId)))[0] ?? null)
      : null;
  const gaps = registerGaps(
    {
      dateOfBirth: dog.dateOfBirth,
      health: health[0] ?? null,
      consents: perms[0] ?? null,
      hasAgreedVet: Boolean(dog.agreedVetId),
    },
    londonDate(new Date()),
  );
  return {
    dog,
    agreedVet,
    registerGaps: gaps,
    health: health[0] ?? null,
    behaviour: behaviour[0] ?? null,
    permissions: perms[0] ?? null,
    vet: vet[0] ?? null,
    submissions: subs,
    evaluation: evals.get(dog.id)!,
  };
}
