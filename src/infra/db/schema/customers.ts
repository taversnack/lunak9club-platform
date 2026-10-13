import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { CONSENT_KEYS } from '../../../domain/compliance/register';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** One customer profile per customer user. Name and email live on `users`. */
export const customers = pgTable('customers', {
  id: uuid().primaryKey().defaultRandom(),
  userId: text()
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: 'restrict' }),
  phone: text(),
  addressLine1: text(),
  addressLine2: text(),
  town: text(),
  postcode: text(),
  archivedAt: timestamp({ withTimezone: true }),
  /** Personal details removed (retention or an approved erasure request, D64/D65). */
  anonymisedAt: timestamp({ withTimezone: true }),
  ...timestamps,
});

/** Emergency contacts and people allowed to collect the customer's dogs. */
export const contacts = pgTable(
  'contacts',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    relationship: text(),
    phone: text().notNull(),
    isEmergencyContact: boolean().notNull().default(false),
    isAuthorisedCollector: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [
    index('contacts_customer_idx').on(t.customerId),
    check('contacts_has_purpose_chk', sql`${t.isEmergencyContact} or ${t.isAuthorisedCollector}`),
  ],
);

export const vets = pgTable(
  'vets',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    practiceName: text().notNull(),
    vetName: text(),
    phone: text().notNull(),
    address: text(),
    ...timestamps,
  },
  (t) => [index('vets_customer_idx').on(t.customerId)],
);

export const DOG_STATUSES = ['not_started', 'pending_review', 'approved', 'suspended', 'rejected'] as const;
export type DogStatus = (typeof DOG_STATUSES)[number];

export const dogs = pgTable(
  'dogs',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    breed: text(),
    sex: text(),
    dateOfBirth: date({ mode: 'string' }),
    weightKg: numeric({ precision: 4, scale: 1, mode: 'number' }),
    microchipNumber: text(),
    neutered: boolean(),
    vetId: uuid().references(() => vets.id, { onDelete: 'set null' }),
    /** The practice the customer agreed we use in an emergency (licence guidance 9.8, D70). May equal vetId. */
    agreedVetId: uuid().references(() => vets.id, { onDelete: 'set null' }),
    /** When the customer last chose or changed the agreed vet. */
    vetAgreedAt: timestamp({ withTimezone: true }),
    status: text().$type<DogStatus>().notNull().default('not_started'),
    /** Reason shown to the customer when suspended/rejected. */
    statusReason: text(),
    onboardingSubmittedAt: timestamp({ withTimezone: true }),
    approvedAt: timestamp({ withTimezone: true }),
    approvedBy: text().references(() => users.id, { onDelete: 'set null' }),
    archivedAt: timestamp({ withTimezone: true }),
    version: integer().notNull().default(1),
    ...timestamps,
  },
  (t) => [
    index('dogs_customer_idx').on(t.customerId),
    index('dogs_status_idx').on(t.status),
    check(
      'dogs_status_chk',
      sql`${t.status} in ('not_started', 'pending_review', 'approved', 'suspended', 'rejected')`,
    ),
    check('dogs_sex_chk', sql`${t.sex} is null or ${t.sex} in ('female', 'male')`),
    check('dogs_weight_chk', sql`${t.weightKg} is null or (${t.weightKg} > 0 and ${t.weightKg} < 150)`),
    check('dogs_microchip_chk', sql`${t.microchipNumber} is null or ${t.microchipNumber} ~ '^[0-9]{9,15}$'`),
    check('dogs_agreed_vet_chk', sql`${t.agreedVetId} is null or ${t.vetAgreedAt} is not null`),
  ],
);

/**
 * Sensitive (D33): Owner and the dog's own customer only. Also holds the licence register fields
 * (Sch. 4 Part 4 para 25(1)(d), (e), (h); D68): treatment dates, exercise restrictions, insurance.
 * The register columns are nullable: dogs onboarded before migration 0014 may not have them (D72).
 */
export const dogHealthProfiles = pgTable(
  'dog_health_profiles',
  {
    dogId: uuid()
      .primaryKey()
      .references(() => dogs.id, { onDelete: 'cascade' }),
    allergies: text(),
    medication: text(),
    dietaryRequirements: text(),
    medicalConditions: text(),
    /** Products used (free text). Dates are in lastWormedOn / lastFleaTreatmentOn. */
    fleaAndWorming: text(),
    lastWormedOn: date({ mode: 'string' }),
    lastFleaTreatmentOn: date({ mode: 'string' }),
    exerciseRestricted: boolean(),
    exerciseRestrictions: text(),
    insured: boolean(),
    insurer: text(),
    insurancePolicyNumber: text(),
    ...timestamps,
  },
  (t) => [
    check(
      'dog_health_exercise_chk',
      sql`(${t.exerciseRestricted} is true and length(coalesce(${t.exerciseRestrictions}, '')) > 0) or (${t.exerciseRestricted} is not true and ${t.exerciseRestrictions} is null)`,
    ),
    check(
      'dog_health_insurance_chk',
      sql`(${t.insured} is true and length(coalesce(${t.insurer}, '')) > 0) or (${t.insured} is not true and ${t.insurer} is null and ${t.insurancePolicyNumber} is null)`,
    ),
  ],
);

/** Sensitive (D33): Owner and the dog's own customer only. */
export const dogBehaviourProfiles = pgTable('dog_behaviour_profiles', {
  dogId: uuid()
    .primaryKey()
    .references(() => dogs.id, { onDelete: 'cascade' }),
  temperament: text(),
  triggers: text(),
  biteHistory: boolean().notNull().default(false),
  biteDetails: text(),
  handlingInstructions: text(),
  emergencyInstructions: text(),
  ...timestamps,
});

/**
 * Owner-given permissions and licence consents for this dog, captured on the onboarding form.
 * Each licence consent (D69) is an explicit yes/no plus when (`_at`) and by whom (`_by`) it was last
 * answered; both change only when the answer changes. Null = not answered yet (dogs from before 0014).
 */
export const dogPermissions = pgTable(
  'dog_permissions',
  {
    dogId: uuid()
      .primaryKey()
      .references(() => dogs.id, { onDelete: 'cascade' }),
    transport: boolean().notNull(),
    photosAndSocialMedia: boolean().notNull(),
    emergencyVetTreatment: boolean().notNull(),
    feedingConsent: boolean(),
    feedingConsentAt: timestamp({ withTimezone: true }),
    feedingConsentBy: text().references(() => users.id, { onDelete: 'set null' }),
    feedingWithOthersConsent: boolean(),
    feedingWithOthersConsentAt: timestamp({ withTimezone: true }),
    feedingWithOthersConsentBy: text().references(() => users.id, { onDelete: 'set null' }),
    cratingConsent: boolean(),
    cratingConsentAt: timestamp({ withTimezone: true }),
    cratingConsentBy: text().references(() => users.id, { onDelete: 'set null' }),
    parasiteTreatmentConsent: boolean(),
    parasiteTreatmentConsentAt: timestamp({ withTimezone: true }),
    parasiteTreatmentConsentBy: text().references(() => users.id, { onDelete: 'set null' }),
    medicationConsent: boolean(),
    medicationConsentAt: timestamp({ withTimezone: true }),
    medicationConsentBy: text().references(() => users.id, { onDelete: 'set null' }),
    groupWalksConsent: boolean(),
    groupWalksConsentAt: timestamp({ withTimezone: true }),
    groupWalksConsentBy: text().references(() => users.id, { onDelete: 'set null' }),
    mixingUnderOneConsent: boolean(),
    mixingUnderOneConsentAt: timestamp({ withTimezone: true }),
    mixingUnderOneConsentBy: text().references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) =>
    CONSENT_KEYS.map((k) =>
      check(
        `dog_permissions_${k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}_chk`,
        // Answer and time are set together; "by" is only set with an answer (it may be cleared if the user goes).
        sql`(${t[k]} is null) = (${t[`${k}At`]} is null) and (${t[k]} is not null or ${t[`${k}By`]} is null)`,
      ),
    ),
);
