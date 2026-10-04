import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { customers, dogs } from './customers';
import { documents } from './compliance';
import { bookingDogs } from './booking';

export const INCIDENT_KINDS = ['injury', 'illness', 'fight', 'behaviour', 'escape', 'other'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export const INCIDENT_SEVERITIES = ['minor', 'moderate', 'serious'] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

/**
 * Incident report (D62). The customer is always told (licence guidance: owners must be told of
 * injury, illness or signs of distress). The original report is locked; corrections and
 * follow-ups are appended as incident_updates. Kept 3 years (licence minimum, D64).
 */
export const incidents = pgTable(
  'incidents',
  {
    id: uuid().primaryKey().defaultRandom(),
    dogId: uuid()
      .notNull()
      .references(() => dogs.id, { onDelete: 'restrict' }),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    bookingDogId: uuid().references(() => bookingDogs.id, { onDelete: 'set null' }),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    kind: text().$type<IncidentKind>().notNull(),
    severity: text().$type<IncidentSeverity>().notNull(),
    /** What happened – shown to the customer. */
    description: text().notNull(),
    /** What was done – shown to the customer. */
    actionTaken: text().notNull(),
    vetContacted: boolean().notNull().default(false),
    vetAdvice: text(),
    /** Owner-only notes. Never shown to the customer. */
    internalNotes: text(),
    status: text().$type<'open' | 'closed'>().notNull().default('open'),
    followUpDue: date({ mode: 'string' }),
    reportedBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    customerNotifiedAt: timestamp({ withTimezone: true }),
    acknowledgedAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    closedBy: text().references(() => users.id, { onDelete: 'set null' }),
    version: integer().notNull().default(1),
  },
  (t) => [
    index('incidents_dog_idx').on(t.dogId, t.occurredAt),
    index('incidents_status_idx').on(t.status),
    check('incidents_kind_chk', sql`${t.kind} in ('injury', 'illness', 'fight', 'behaviour', 'escape', 'other')`),
    check('incidents_severity_chk', sql`${t.severity} in ('minor', 'moderate', 'serious')`),
    check('incidents_status_chk', sql`${t.status} in ('open', 'closed')`),
    check('incidents_closed_chk', sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`),
    check('incidents_text_chk', sql`length(${t.description}) > 0 and length(${t.actionTaken}) > 0`),
  ],
);

/** Follow-ups and corrections to an incident. Append-only. */
export const incidentUpdates = pgTable(
  'incident_updates',
  {
    id: uuid().primaryKey().defaultRandom(),
    incidentId: uuid()
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    body: text().notNull(),
    sharedWithCustomer: boolean().notNull().default(true),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('incident_updates_incident_idx').on(t.incidentId),
    check('incident_updates_body_chk', sql`length(${t.body}) > 0`),
  ],
);

export const incidentPhotos = pgTable(
  'incident_photos',
  {
    incidentId: uuid()
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    documentId: uuid()
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.incidentId, t.documentId] })],
);

export const WELFARE_CONCERNS = [
  'drinking_more',
  'drinking_less',
  'stress',
  'fear',
  'aggression',
  'anxiety',
  'pain',
] as const;
export type WelfareConcern = (typeof WELFARE_CONCERNS)[number];

/**
 * Daily welfare check (D63). Private to the Owner unless shared; a check that records something
 * the licence says the owner must be told about is shared with the customer automatically.
 */
export const welfareChecks = pgTable(
  'welfare_checks',
  {
    id: uuid().primaryKey().defaultRandom(),
    dogId: uuid()
      .notNull()
      .references(() => dogs.id, { onDelete: 'restrict' }),
    bookingDogId: uuid().references(() => bookingDogs.id, { onDelete: 'set null' }),
    serviceDate: date({ mode: 'string' }).notNull(),
    ate: text().$type<'all' | 'some' | 'none' | 'not_fed'>().notNull(),
    drinking: text().$type<'normal' | 'more' | 'less'>().notNull(),
    toileting: text().$type<'normal' | 'unusual'>().notNull(),
    mood: text().$type<'happy' | 'settled' | 'unsettled'>().notNull(),
    concerns: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    medicationGiven: text(),
    note: text(),
    shared: boolean().notNull().default(false),
    /** Shared because a concern the licence says the owner must be told about was recorded. */
    autoShared: boolean().notNull().default(false),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('welfare_checks_dog_idx').on(t.dogId, t.serviceDate),
    check('welfare_checks_ate_chk', sql`${t.ate} in ('all', 'some', 'none', 'not_fed')`),
    check('welfare_checks_drinking_chk', sql`${t.drinking} in ('normal', 'more', 'less')`),
    check('welfare_checks_toileting_chk', sql`${t.toileting} in ('normal', 'unusual')`),
    check('welfare_checks_mood_chk', sql`${t.mood} in ('happy', 'settled', 'unsettled')`),
    check(
      'welfare_checks_concerns_chk',
      sql`${t.concerns} <@ array['drinking_more', 'drinking_less', 'stress', 'fear', 'aggression', 'anxiety', 'pain']::text[]`,
    ),
    check('welfare_checks_autoshare_chk', sql`not ${t.autoShared} or ${t.shared}`),
  ],
);

/** One row per reminder email sent, keyed so each reminder goes once (non-negotiable 3). */
export const notificationLog = pgTable(
  'notification_log',
  {
    key: text().primaryKey(),
    kind: text().notNull(),
    sentAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notification_log_sent_idx').on(t.sentAt)],
);

export const DATA_REQUEST_STATUSES = ['requested', 'approved', 'declined', 'completed'] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

/**
 * A customer's request to delete their account (UK GDPR right to erasure, D65). Approval disables
 * sign-in straight away; personal details are anonymised when the records the law requires us to
 * keep reach the end of their retention period (`retain_until`).
 */
export const dataRequests = pgTable(
  'data_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    kind: text().$type<'erasure'>().notNull().default('erasure'),
    status: text().$type<DataRequestStatus>().notNull().default('requested'),
    customerReason: text(),
    decisionReason: text(),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedBy: text().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp({ withTimezone: true }),
    retainUntil: date({ mode: 'string' }),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('data_requests_status_idx').on(t.status),
    check('data_requests_kind_chk', sql`${t.kind} in ('erasure')`),
    check('data_requests_status_chk', sql`${t.status} in ('requested', 'approved', 'declined', 'completed')`),
    check(
      'data_requests_declined_chk',
      sql`${t.status} <> 'declined' or length(coalesce(${t.decisionReason}, '')) > 0`,
    ),
  ],
);
