import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { customers, dogs } from './customers';
import { bookingDogs } from './booking';

/**
 * Effective-dated price book (D44). Date ranges never overlap (EXCLUDE constraint added in
 * migration). effective_to null = open-ended. All money in pence.
 */
export const priceBooks = pgTable(
  'price_books',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    effectiveFrom: date({ mode: 'string' }).notNull(),
    effectiveTo: date({ mode: 'string' }),
    adHocFullPence: integer().notNull(),
    memberLowFullPence: integer().notNull(),
    memberHighFullPence: integer().notNull(),
    /** Days per week at or above which the high band applies (4 → "4–5 days"). */
    memberHighFromDays: integer().notNull().default(4),
    halfDayPercent: integer().notNull().default(50),
    taxiPence: integer().notNull().default(0),
    multiDogDiscountPercent: integer().notNull().default(0),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'price_books_money_chk',
      sql`${t.adHocFullPence} >= 0 and ${t.memberLowFullPence} >= 0 and ${t.memberHighFullPence} >= 0 and ${t.taxiPence} >= 0`,
    ),
    check(
      'price_books_percent_chk',
      sql`${t.halfDayPercent} between 1 and 100 and ${t.multiDogDiscountPercent} between 0 and 100`,
    ),
    check('price_books_band_chk', sql`${t.memberHighFromDays} between 2 and 7`),
    check('price_books_range_chk', sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
  ],
);

/** Customer-specific rates (D12, D46). dog_id null = all of the customer's dogs. */
export const customerRates = pgTable(
  'customer_rates',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    dogId: uuid().references(() => dogs.id, { onDelete: 'restrict' }),
    fullDayPence: integer().notNull(),
    halfDayPence: integer(),
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }),
    reason: text().notNull(),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('customer_rates_customer_idx').on(t.customerId),
    check(
      'customer_rates_money_chk',
      sql`${t.fullDayPence} >= 0 and (${t.halfDayPence} is null or ${t.halfDayPence} >= 0)`,
    ),
    check('customer_rates_range_chk', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    check('customer_rates_reason_chk', sql`length(${t.reason}) > 0`),
  ],
);

export const MEMBERSHIP_STATUSES = ['requested', 'active', 'declined', 'ended', 'withdrawn'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** A dog's regular weekly days (D47). */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    dogId: uuid()
      .notNull()
      .references(() => dogs.id, { onDelete: 'restrict' }),
    /** ISO weekdays, 1 = Monday. */
    weekdays: integer().array().notNull(),
    session: text().notNull(),
    taxi: boolean().notNull().default(false),
    status: text().$type<MembershipStatus>().notNull(),
    startsOn: date({ mode: 'string' }).notNull(),
    endsOn: date({ mode: 'string' }),
    /** The membership this one replaces (a change of days). */
    replacesId: uuid(),
    requestedBy: text()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    decidedBy: text().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp({ withTimezone: true }),
    declineReason: text(),
    version: integer().notNull().default(1),
  },
  (t) => [
    index('memberships_dog_idx').on(t.dogId, t.status),
    check('memberships_status_chk', sql`${t.status} in ('requested', 'active', 'declined', 'ended', 'withdrawn')`),
    check('memberships_session_chk', sql`${t.session} in ('full', 'am', 'pm')`),
    check(
      'memberships_weekdays_chk',
      sql`cardinality(${t.weekdays}) between 1 and 7 and ${t.weekdays} <@ array[1,2,3,4,5,6,7]`,
    ),
    check('memberships_range_chk', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
  ],
);

/**
 * Price locked at booking time for one dog-day (D45). Append-only (trigger in migration):
 * later price changes never alter it. Phase 5 invoices are built from these rows.
 */
export const priceSnapshots = pgTable(
  'price_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingDogId: uuid()
      .notNull()
      .references(() => bookingDogs.id, { onDelete: 'restrict' }),
    priceBookId: uuid().references(() => priceBooks.id, { onDelete: 'restrict' }),
    customerRateId: uuid().references(() => customerRates.id, { onDelete: 'restrict' }),
    rateCode: text().notNull(),
    basePence: integer().notNull(),
    discountPence: integer().notNull().default(0),
    taxiPence: integer().notNull().default(0),
    totalPence: integer().notNull(),
    explanation: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('price_snapshots_booking_dog_uq').on(t.bookingDogId),
    check(
      'price_snapshots_total_chk',
      sql`${t.totalPence} = ${t.basePence} - ${t.discountPence} + ${t.taxiPence} and ${t.totalPence} >= 0`,
    ),
  ],
);
