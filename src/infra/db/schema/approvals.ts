import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { customers } from './customers';
import type { ApprovalStatus } from '../../../domain/approvals/rules';

/**
 * Anything a customer asks for that needs the Owner's yes or no (booking requests, membership day
 * changes …), one generic row per request (D77). `type` picks the handler registered in
 * src/server/services/approvals.ts; `subject_key` names the thing the request is about (for example
 * `booking:<bookingId>`), and only one request per subject can be pending at a time.
 * `payload` is validated by the type's Zod schema and must not hold sensitive details (D33);
 * `reason` is the Owner's optional note, shown in the portal only – never in emails.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    type: text().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    subjectKey: text().notNull(),
    payload: jsonb().$type<unknown>().notNull(),
    status: text().$type<ApprovalStatus>().notNull().default('pending'),
    decidedBy: text().references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp({ withTimezone: true }),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('approval_requests_status_created_idx').on(t.status, t.createdAt),
    // Only one request per subject can be waiting at a time (D77).
    uniqueIndex('approval_requests_one_pending_uq')
      .on(t.type, t.subjectKey)
      .where(sql`${t.status} = 'pending'`),
    check(
      'approval_requests_status_chk',
      sql`${t.status} in ('pending', 'approved', 'rejected', 'withdrawn', 'expired')`,
    ),
  ],
);
