import 'server-only';
import { desc } from 'drizzle-orm';
import { auditEvents } from '@/infra/db/schema';
import type { Db } from '@/infra/db/client';
import { assertAuthorized, type Actor } from '../policy/authorize';

export async function listRecentAuditEvents(db: Db, actor: Actor, limit = 20) {
  assertAuthorized(actor, 'audit.read');
  return db
    .select({
      id: auditEvents.id,
      occurredAt: auditEvents.occurredAt,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      outcome: auditEvents.outcome,
      actorType: auditEvents.actorType,
    })
    .from(auditEvents)
    .orderBy(desc(auditEvents.id))
    .limit(Math.min(Math.max(limit, 1), 100));
}
