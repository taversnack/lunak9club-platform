import 'server-only';
import { and, asc, eq, isNull, desc } from 'drizzle-orm';
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
import { checkbox, idOrNotFound, isoDate, optionalText, parseInput, requiredText, ukPhone } from '../validation';
import { asUser, getMyCustomer } from './customers';
import { evaluateDogs } from './compliance-facts';

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

export const VetInput = z.object({
  practiceName: requiredText('the practice name', 120),
  vetName: optionalText(120),
  phone: ukPhone,
  address: optionalText(300),
});

export async function saveMyDogVet(db: Db, actor: Actor, dogId: string, input: unknown) {
  const data = parseInput(VetInput, input);
  const dog = await loadMyDog(db, actor, dogId);
  await db.transaction(async (tx) => {
    if (dog.vetId) {
      await tx
        .update(vets)
        .set(data)
        .where(and(eq(vets.id, dog.vetId), eq(vets.customerId, dog.customerId)));
    } else {
      const [v] = await tx
        .insert(vets)
        .values({ ...data, customerId: dog.customerId })
        .returning({ id: vets.id });
      await tx.update(dogs).set({ vetId: v!.id }).where(eq(dogs.id, dog.id));
    }
    await recordAudit(tx, { actor, action: 'dog.vet_saved', entityType: 'dog', entityId: dog.id });
  });
}

const yesNo = (msg: string) => z.enum(['yes', 'no'], { message: msg }).transform((v) => v === 'yes');

export const OnboardingInput = z
  .object({
    allergies: optionalText(),
    medication: optionalText(),
    dietaryRequirements: optionalText(),
    medicalConditions: optionalText(),
    fleaAndWorming: requiredText('when flea and worming treatment was last given', 500),
    temperament: requiredText('a short description of your dog’s temperament', 2000),
    triggers: optionalText(),
    biteHistory: yesNo('Tell us if your dog has ever bitten or shown aggression'),
    biteDetails: optionalText(),
    handlingInstructions: optionalText(),
    emergencyInstructions: optionalText(),
    transport: yesNo('Tell us if we may use the dog taxi'),
    photosAndSocialMedia: yesNo('Tell us if we may share photos'),
    emergencyVetTreatment: yesNo('Tell us if we may arrange emergency vet treatment'),
    confirmAccurate: checkbox.refine((v) => v, 'Please confirm the information is accurate'),
  })
  .refine((d) => !d.biteHistory || Boolean(d.biteDetails), {
    message: 'Please tell us what happened',
    path: ['biteDetails'],
  });

/** Save the onboarding form (health, behaviour, permissions). Sensitive: never logged or audited in detail. */
export async function submitMyOnboardingForm(db: Db, actor: Actor, dogId: string, input: unknown) {
  const d = parseInput(OnboardingInput, input);
  const dog = await loadMyDog(db, actor, dogId);
  await db.transaction(async (tx) => {
    const health = {
      allergies: d.allergies,
      medication: d.medication,
      dietaryRequirements: d.dietaryRequirements,
      medicalConditions: d.medicalConditions,
      fleaAndWorming: d.fleaAndWorming,
    };
    const behaviour = {
      temperament: d.temperament,
      triggers: d.triggers,
      biteHistory: d.biteHistory,
      biteDetails: d.biteHistory ? d.biteDetails : null,
      handlingInstructions: d.handlingInstructions,
      emergencyInstructions: d.emergencyInstructions,
    };
    const perms = {
      transport: d.transport,
      photosAndSocialMedia: d.photosAndSocialMedia,
      emergencyVetTreatment: d.emergencyVetTreatment,
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
    await tx.update(dogs).set({ onboardingSubmittedAt: new Date() }).where(eq(dogs.id, dog.id));
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
  return {
    dog,
    health: health[0] ?? null,
    behaviour: behaviour[0] ?? null,
    permissions: perms[0] ?? null,
    vet: vet[0] ?? null,
    submissions: subs,
    evaluation: evals.get(dog.id)!,
  };
}
