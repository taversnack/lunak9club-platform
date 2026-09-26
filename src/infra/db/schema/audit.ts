import { bigserial, check, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Append-only audit trail. A trigger (see migration `audit_append_only`) rejects
 * UPDATE/DELETE unless a maintenance flag is set inside a reviewed retention job.
 * `metadata` must never contain personal or sensitive details — see src/server/audit.ts.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actorType: text().notNull(),
    actorUserId: text(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    outcome: text().notNull().default('success'),
    metadata: jsonb().$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  },
  (t) => [
    check('audit_events_actor_type_chk', sql`${t.actorType} in ('user', 'system')`),
    check('audit_events_outcome_chk', sql`${t.outcome} in ('success', 'denied', 'failure')`),
    index('audit_events_entity_idx').on(t.entityType, t.entityId),
    index('audit_events_actor_idx').on(t.actorUserId),
    index('audit_events_occurred_at_idx').on(t.occurredAt),
  ],
);
