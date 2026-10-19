import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { customers, dogs } from './customers';

/**
 * "Finish signing up" invite for a customer account the Owner created (D86). Only a SHA-256 hash of
 * the token is stored. Valid for 7 days and single use; resending ends any earlier unused invite.
 */
export const customerInvites = pgTable(
  'customer_invites',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('customer_invites_token_uq').on(t.tokenHash), index('customer_invites_user_idx').on(t.userId)],
);

/**
 * Days the Owner agreed for one dog at account creation (D86, D87) – one offer per dog. The Owner
 * names the dog; the customer links the offer to that dog once they've added it, then confirms the
 * days unchanged (membership starts, no approval) or asks for other days (membership.days request).
 */
export const membershipOffers = pgTable(
  'membership_offers',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    /** The dog's name as the Owner entered it (the dog record doesn't exist yet). */
    dogName: text().notNull(),
    /** Set when the customer links the offer to the dog they added. */
    dogId: uuid().references(() => dogs.id, { onDelete: 'set null' }),
    /** ISO weekdays, 1 = Monday. */
    weekdays: integer().array().notNull(),
    session: text().notNull(),
    taxi: boolean().notNull().default(false),
    startsOn: date({ mode: 'string' }).notNull(),
    createdBy: text().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Set when the offer is used up: confirmed, replaced by a request, or withdrawn by the Owner. */
    closedAt: timestamp({ withTimezone: true }),
    confirmedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('membership_offers_customer_idx').on(t.customerId),
    check('membership_offers_dog_name_chk', sql`length(${t.dogName}) between 1 and 60`),
    check('membership_offers_session_chk', sql`${t.session} in ('full', 'am', 'pm')`),
    check(
      'membership_offers_weekdays_chk',
      sql`cardinality(${t.weekdays}) between 1 and 7 and ${t.weekdays} <@ array[1,2,3,4,5,6,7]`,
    ),
  ],
);

/** A customer confirmed their membership days for a month (D88), or the Owner did for them. */
export const membershipMonthConfirmations = pgTable(
  'membership_month_confirmations',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    /** YYYY-MM */
    month: text().notNull(),
    confirmedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    confirmedBy: text().references(() => users.id, { onDelete: 'set null' }),
    byOwner: boolean().notNull().default(false),
    /** Confirmed after the month's confirm-by date: still accepted, shown as late (D94). */
    late: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex('membership_month_confirmations_uq').on(t.customerId, t.month),
    check('membership_month_confirmations_month_chk', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);
