import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { customers, dogs } from './customers';

/** Single-row operating settings (id is always 1). Changes are audited. */
export const bookingSettings = pgTable(
  'booking_settings',
  {
    id: integer().primaryKey().default(1),
    sessionCapacity: integer().notNull().default(20),
    taxiCapacity: integer().notNull().default(20),
    /** ISO weekdays open, 1 = Monday … 7 = Sunday. */
    openWeekdays: integer()
      .array()
      .notNull()
      .default(sql`'{1,2,3,4,5}'::integer[]`),
    fullDayStart: text().notNull().default('07:30'),
    fullDayEnd: text().notNull().default('18:00'),
    morningStart: text().notNull().default('08:00'),
    morningEnd: text().notNull().default('12:00'),
    afternoonStart: text().notNull().default('12:00'),
    afternoonEnd: text().notNull().default('16:00'),
    maxAdvanceDays: integer().notNull().default(90),
    freeCancellationHours: integer().notNull().default(48),
    waitlistOfferHours: integer().notNull().default(12),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('booking_settings_singleton_chk', sql`${t.id} = 1`),
    check(
      'booking_settings_capacity_chk',
      sql`${t.sessionCapacity} between 0 and 200 and ${t.taxiCapacity} between 0 and 200`,
    ),
  ],
);

/** Days the daycare is closed (bank holidays seeded; Owner can add more). */
export const closures = pgTable('closures', {
  serviceDate: date({ mode: 'string' }).primaryKey(),
  reason: text().notNull(),
  createdBy: text().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per operating date, created on first use. Booking transactions lock this row
 * (SELECT … FOR UPDATE) so capacity checks and inserts for a date are serialised.
 * Null capacities mean "use the default from booking_settings".
 */
export const serviceDays = pgTable(
  'service_days',
  {
    serviceDate: date({ mode: 'string' }).primaryKey(),
    sessionCapacity: integer(),
    taxiCapacity: integer(),
    note: text(),
    version: integer().notNull().default(1),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      'service_days_capacity_chk',
      sql`(${t.sessionCapacity} is null or ${t.sessionCapacity} between 0 and 200) and (${t.taxiCapacity} is null or ${t.taxiCapacity} between 0 and 200)`,
    ),
  ],
);

/** A customer's request covering one or more dog-days. */
export const bookings = pgTable(
  'bookings',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    createdBy: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    source: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('bookings_source_chk', sql`${t.source} in ('customer', 'owner')`),
    index('bookings_customer_idx').on(t.customerId),
  ],
);

export const SESSIONS = ['full', 'am', 'pm'] as const;
export type Session = (typeof SESSIONS)[number];
export const BOOKING_STATUSES = [
  'confirmed',
  'waitlisted',
  'offered',
  'cancelled',
  'attended',
  'no_show',
  'rejected',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** The unit of capacity: one dog, one date, one session. */
export const bookingDogs = pgTable(
  'booking_dogs',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid()
      .notNull()
      .references(() => bookings.id, { onDelete: 'restrict' }),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    dogId: uuid()
      .notNull()
      .references(() => dogs.id, { onDelete: 'restrict' }),
    serviceDate: date({ mode: 'string' })
      .notNull()
      .references(() => serviceDays.serviceDate, { onDelete: 'restrict' }),
    session: text().$type<Session>().notNull(),
    taxi: boolean().notNull().default(false),
    status: text().$type<BookingStatus>().notNull(),
    /** Customer-visible note (e.g. "collect at 5pm"). */
    customerNote: text(),
    /** Owner-only note. Never shown to customers. */
    internalNote: text(),
    overrideReason: text(),
    offerExpiresAt: timestamp({ withTimezone: true }),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelledBy: text().references(() => users.id, { onDelete: 'set null' }),
    lateCancellation: boolean().notNull().default(false),
    checkedInAt: timestamp({ withTimezone: true }),
    checkedOutAt: timestamp({ withTimezone: true }),
    attendanceBy: text().references(() => users.id, { onDelete: 'set null' }),
    version: integer().notNull().default(1),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('booking_dogs_date_idx').on(t.serviceDate, t.status),
    index('booking_dogs_customer_idx').on(t.customerId, t.serviceDate),
    // A dog can only hold one live booking (or waitlist place) per day (D38).
    uniqueIndex('booking_dogs_one_per_dog_day_uq')
      .on(t.dogId, t.serviceDate)
      .where(sql`${t.status} in ('confirmed', 'waitlisted', 'offered', 'attended', 'no_show')`),
    check('booking_dogs_session_chk', sql`${t.session} in ('full', 'am', 'pm')`),
    check(
      'booking_dogs_status_chk',
      sql`${t.status} in ('confirmed', 'waitlisted', 'offered', 'cancelled', 'attended', 'no_show', 'rejected')`,
    ),
    check('booking_dogs_offer_chk', sql`${t.status} <> 'offered' or ${t.offerExpiresAt} is not null`),
    check('booking_dogs_cancel_chk', sql`${t.status} <> 'cancelled' or ${t.cancelledAt} is not null`),
    check('booking_dogs_checkout_chk', sql`${t.checkedOutAt} is null or ${t.checkedInAt} is not null`),
  ],
);
