import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { customers, dogs } from './customers';

export const REQUIREMENT_KINDS = [
  'vaccination',
  'vet_details',
  'emergency_contact',
  'onboarding_form',
  'terms',
  'assessment',
] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

/** Configurable onboarding requirements (D31). Reference rows seeded by migration. */
export const complianceRequirements = pgTable(
  'compliance_requirements',
  {
    key: text().primaryKey(),
    label: text().notNull(),
    description: text().notNull(),
    kind: text().$type<RequirementKind>().notNull(),
    mandatory: boolean().notNull().default(true),
    blocksBooking: boolean().notNull().default(true),
    reminderDays: integer()
      .array()
      .notNull()
      .default(sql`'{60,30,14,7}'::integer[]`),
    sortOrder: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      'compliance_requirements_kind_chk',
      sql`${t.kind} in ('vaccination', 'vet_details', 'emergency_contact', 'onboarding_form', 'terms', 'assessment')`,
    ),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    dogId: uuid().references(() => dogs.id, { onDelete: 'restrict' }),
    storageKey: text().notNull().unique(),
    displayName: text().notNull(),
    contentType: text().notNull(),
    sizeBytes: integer().notNull(),
    sha256: text().notNull(),
    scanStatus: text().notNull().default('not_scanned'),
    /** compliance = vaccination records etc.; incident = photos attached to an incident report. */
    purpose: text().$type<'compliance' | 'incident'>().notNull().default('compliance'),
    uploadedBy: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('documents_dog_idx').on(t.dogId),
    index('documents_customer_idx').on(t.customerId),
    check('documents_size_chk', sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 10485760`),
    check('documents_scan_chk', sql`${t.scanStatus} in ('not_scanned', 'clean', 'infected')`),
  ],
);

export const SUBMISSION_STATUSES = [
  'pending_review',
  'approved',
  'rejected',
  'replacement_requested',
  'superseded',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Evidence for a document-based requirement (vaccinations), reviewed by the Owner. */
export const complianceSubmissions = pgTable(
  'compliance_submissions',
  {
    id: uuid().primaryKey().defaultRandom(),
    dogId: uuid()
      .notNull()
      .references(() => dogs.id, { onDelete: 'restrict' }),
    requirementKey: text()
      .notNull()
      .references(() => complianceRequirements.key, { onDelete: 'restrict' }),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    status: text().$type<SubmissionStatus>().notNull().default('pending_review'),
    expiresOn: date({ mode: 'string' }).notNull(),
    /** Date the vaccination was given (licence para 25(1)(h), D68). Null on records sent before migration 0014. */
    administeredOn: date({ mode: 'string' }),
    /** D74: set when the customer says this record is the dog's first (primary) course – the date it finished. */
    primaryCourseCompletedOn: date({ mode: 'string' }),
    submittedBy: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    reviewedBy: text().references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp({ withTimezone: true }),
    /** Shown to the customer when rejected or a replacement is requested. */
    reviewReason: text(),
    version: integer().notNull().default(1),
  },
  (t) => [
    index('compliance_submissions_dog_idx').on(t.dogId),
    index('compliance_submissions_status_idx').on(t.status),
    // At most one waiting-for-review and one approved submission per dog and requirement.
    uniqueIndex('compliance_submissions_one_pending_uq')
      .on(t.dogId, t.requirementKey)
      .where(sql`${t.status} = 'pending_review'`),
    uniqueIndex('compliance_submissions_one_approved_uq')
      .on(t.dogId, t.requirementKey)
      .where(sql`${t.status} = 'approved'`),
    check(
      'compliance_submissions_status_chk',
      sql`${t.status} in ('pending_review', 'approved', 'rejected', 'replacement_requested', 'superseded')`,
    ),
    check(
      'compliance_submissions_administered_chk',
      sql`${t.administeredOn} is null or ${t.administeredOn} <= ${t.expiresOn}`,
    ),
    check(
      'compliance_submissions_reason_chk',
      sql`${t.status} not in ('rejected', 'replacement_requested') or length(coalesce(${t.reviewReason}, '')) > 0`,
    ),
  ],
);

export const ASSESSMENT_KINDS = ['meet_and_greet', 'trial_day'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];
export const ASSESSMENT_OUTCOMES = ['passed', 'not_passed', 'rescheduled'] as const;
export type AssessmentOutcome = (typeof ASSESSMENT_OUTCOMES)[number];

export const assessments = pgTable(
  'assessments',
  {
    id: uuid().primaryKey().defaultRandom(),
    dogId: uuid()
      .notNull()
      .references(() => dogs.id, { onDelete: 'restrict' }),
    kind: text().$type<AssessmentKind>().notNull(),
    outcome: text().$type<AssessmentOutcome>().notNull(),
    assessedOn: date({ mode: 'string' }).notNull(),
    /** Owner-only notes. Never shown to customers. */
    internalNotes: text(),
    recordedBy: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    recordedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assessments_dog_idx').on(t.dogId, t.kind),
    check('assessments_kind_chk', sql`${t.kind} in ('meet_and_greet', 'trial_day')`),
    check('assessments_outcome_chk', sql`${t.outcome} in ('passed', 'not_passed', 'rescheduled')`),
  ],
);

export const policyVersions = pgTable(
  'policy_versions',
  {
    id: uuid().primaryKey().defaultRandom(),
    policyKey: text().notNull(),
    version: integer().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedBy: text().references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('policy_versions_key_version_uq').on(t.policyKey, t.version),
    check('policy_versions_key_chk', sql`${t.policyKey} in ('terms')`),
  ],
);

export const policyAcknowledgements = pgTable(
  'policy_acknowledgements',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    policyVersionId: uuid()
      .notNull()
      .references(() => policyVersions.id, { onDelete: 'restrict' }),
    acknowledgedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.policyVersionId] })],
);
