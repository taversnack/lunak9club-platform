import 'server-only';
import { auditEvents } from '@/infra/db/schema';
import type { Db } from '@/infra/db/client';
import type { Actor } from './policy/authorize';

export type AuditMetadata = Record<string, string | number | boolean | null>;

// Keys that must never appear in audit metadata (personal or sensitive data, incl. register fields D68–D69).
const FORBIDDEN_KEY =
  /(email|name|phone|address|password|token|secret|card|iban|medical|medication|allerg|behaviour|bite|note|dob|birth|insur|policy|exercise|worm|flea|consent)/i;

export function sanitiseMetadata(metadata: AuditMetadata = {}): AuditMetadata {
  const out: AuditMetadata = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (FORBIDDEN_KEY.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
  }
  return out;
}

export type AuditInput = {
  actor: Actor;
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome?: 'success' | 'denied' | 'failure';
  metadata?: AuditMetadata;
};

/** Append an audit event. Pass a transaction handle to keep it atomic with the change it records. */
export async function recordAudit(db: Pick<Db, 'insert'>, input: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorType: input.actor.kind === 'system' ? 'system' : 'user',
    actorUserId: input.actor.kind === 'user' ? input.actor.userId : null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    outcome: input.outcome ?? 'success',
    metadata: sanitiseMetadata({
      ...(input.actor.kind === 'system' ? { job: input.actor.job } : {}),
      ...input.metadata,
    }),
  });
}
