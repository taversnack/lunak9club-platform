import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';

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
  ],
);

/** Sensitive (D33): Owner and the dog's own customer only. */
export const dogHealthProfiles = pgTable('dog_health_profiles', {
  dogId: uuid()
    .primaryKey()
    .references(() => dogs.id, { onDelete: 'cascade' }),
  allergies: text(),
  medication: text(),
  dietaryRequirements: text(),
  medicalConditions: text(),
  fleaAndWorming: text(),
  ...timestamps,
});

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

/** Owner-given permissions for this dog, captured on the onboarding form. */
export const dogPermissions = pgTable('dog_permissions', {
  dogId: uuid()
    .primaryKey()
    .references(() => dogs.id, { onDelete: 'cascade' }),
  transport: boolean().notNull(),
  photosAndSocialMedia: boolean().notNull(),
  emergencyVetTreatment: boolean().notNull(),
  ...timestamps,
});
