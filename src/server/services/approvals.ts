import 'server-only';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import { approvalRequests, customers, users } from '@/infra/db/schema';
import {
  clampSummary,
  DECISION_RESULT,
  isValidApprovalType,
  isValidSubjectKey,
  nextStatus,
  OUTCOME_TEXT,
  skipsGenericEmail,
  type ApprovalDecision,
  type ApprovalRecord,
  type ApprovalStatus,
  type ApprovalTypeShape,
  type OwnerContextSection,
} from '@/domain/approvals';
import { approvalDecisionMessage, approvalRequestedOwnerMessage } from '@/infra/email/templates';
import { logger } from '@/infra/logger';
import { assertAuthorized, hasPermission, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError } from '../errors';
import { appUrl, firstNameOf, ownerEmails, sendSafely } from '../notify';
import { idOrNotFound, optionalText, parseInput } from '../validation';
import { asUser, getMyCustomer } from './customers';

/**
 * Generic approval requests (D77): anything a customer asks for that needs the Owner's yes or no.
 * Each kind of request is an approval type registered once (see approval-types.ts) with a Zod schema
 * for its payload, a non-sensitive describe(), and handlers that run inside the decision's transaction.
 * This module owns the table, permissions, state machine, audit and the generic emails.
 */

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** What a type's onApprove / onReject / onWithdraw / onExpire receive. Do all writes through `tx`. */
export type ApprovalHandlerContext = {
  tx: Tx;
  actor: Actor;
  now: Date;
  /** The Owner's optional note (approve / reject only). Portal only – never put it in an email. */
  reason: string | null;
};

/** An approval type, as passed to registerApprovalType(). */
export type ApprovalType<P> = ApprovalTypeShape<P, ApprovalHandlerContext, Db>;

export type { ApprovalDecision, ApprovalRecord, ApprovalStatus, OwnerContextSection };

// ---- Registry ----------------------------------------------------------------------------

// Stored with the payload type erased: every payload is re-checked with the type's own schema before
// a handler sees it, so the cast below can't let an unchecked payload through.
const registry = new Map<string, ApprovalType<unknown>>();

/** Register an approval type. Call once at module load from a file imported by approval-types.ts. */
export function registerApprovalType<P>(def: ApprovalType<P>): void {
  if (!isValidApprovalType(def.type)) throw new Error(`Invalid approval type name: ${def.type}`);
  const existing = registry.get(def.type);
  if (existing && existing !== (def as unknown as ApprovalType<unknown>))
    throw new Error(`Approval type already registered: ${def.type}`);
  registry.set(def.type, def as unknown as ApprovalType<unknown>);
}

export function getApprovalType(type: string): ApprovalType<unknown> | undefined {
  return registry.get(type);
}

export function registeredApprovalTypes(): { type: string; label: string }[] {
  return [...registry.values()].map((d) => ({ type: d.type, label: d.label }));
}

let loading: Promise<unknown> | null = null;
/** Load every registration (approval-types.ts) before the registry is used. Dynamic to avoid an import cycle. */
async function ensureTypesLoaded() {
  loading ??= import('./approval-types');
  await loading;
}

function requireType(type: string): ApprovalType<unknown> {
  const def = registry.get(type);
  if (!def) throw new ConflictError('This kind of request can’t be handled right now.');
  return def;
}

type Row = typeof approvalRequests.$inferSelect;

function toRecord<P>(row: Row, payload: P): ApprovalRecord<P> {
  return { ...row, payload };
}

function checkedPayload(def: ApprovalType<unknown>, row: Row): unknown {
  const r = def.schema.safeParse(row.payload);
  if (!r.success) {
    logger.error({ type: row.type }, 'approval request payload no longer valid');
    throw new ConflictError('This request can’t be handled. Please ask the customer to send it again.');
  }
  return r.data;
}

function summaryOf(def: ApprovalType<unknown> | undefined, row: Row): string {
  if (!def) return 'Request details unavailable';
  const r = def.schema.safeParse(row.payload);
  if (!r.success) return 'Request details unavailable';
  try {
    return clampSummary(def.describe(r.data));
  } catch {
    return 'Request details unavailable';
  }
}

// ---- Create ------------------------------------------------------------------------------

export type CreateApprovalInput = {
  /** A registered type, e.g. `booking.request`. */
  type: string;
  customerId: string;
  /** `<kind>:<id>`, e.g. `booking:<bookingId>`. Only one pending request per (type, subjectKey). */
  subjectKey: string;
  /** Checked with the type's schema. No sensitive details. */
  payload: unknown;
};

/**
 * Raise a request. The customer may raise their own (approvals.self.manage); the Owner and the
 * scheduler may raise one for any customer. Pass `opts.tx` to create it inside your own transaction –
 * then call `notifyOwner()` after your transaction commits. Without `tx` the request is created in its
 * own transaction and the Owner is emailed straight away (notifyOwner is then a no-op).
 * Throws ConflictError if a request for the same subject is already pending.
 */
export async function createApprovalRequest(
  db: Db,
  actor: Actor,
  input: CreateApprovalInput,
  opts: { tx?: Tx } = {},
): Promise<{ id: string; notifyOwner: () => Promise<void> }> {
  await ensureTypesLoaded();
  const def = registry.get(input.type);
  if (!def) throw new Error(`Approval type not registered: ${input.type}`);
  if (!isValidSubjectKey(input.subjectKey)) throw new Error(`Invalid approval subject key for ${input.type}`);
  const customerId = idOrNotFound(input.customerId, 'Customer');
  const payload = parseInput(def.schema, input.payload);

  const insert = async (q: Tx) => {
    const [customer] = await q.select({ userId: customers.userId }).from(customers).where(eq(customers.id, customerId));
    if (!customer) throw new NotFoundError('Customer');
    if (!hasPermission(actor, 'approvals.manage'))
      assertAuthorized(actor, 'approvals.self.manage', { ownerUserId: customer.userId });
    const [dup] = await q
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.type, def.type),
          eq(approvalRequests.subjectKey, input.subjectKey),
          eq(approvalRequests.status, 'pending'),
        ),
      );
    if (dup) throw duplicateError();
    let row: { id: string } | undefined;
    try {
      [row] = await q
        .insert(approvalRequests)
        .values({ type: def.type, customerId, subjectKey: input.subjectKey, payload })
        .returning({ id: approvalRequests.id });
    } catch (err) {
      // Two requests for the same subject at once: the unique partial index keeps just one (D77).
      if (isUniqueViolation(err)) throw duplicateError();
      throw err;
    }
    await recordAudit(q, {
      actor,
      action: 'approval.requested',
      entityType: 'approval_request',
      entityId: row!.id,
      metadata: { type: def.type },
    });
    return row!.id;
  };

  let sent = false;
  const notifyOwner = async () => {
    if (sent) return;
    sent = true;
    for (const to of await ownerEmails(db))
      await sendSafely(approvalRequestedOwnerMessage(to, { label: def.label }, appUrl('/admin/approvals')));
  };

  if (opts.tx) return { id: await insert(opts.tx), notifyOwner };
  const id = await db.transaction((tx) => insert(tx));
  await notifyOwner();
  return { id, notifyOwner };
}

const duplicateError = () => new ConflictError('There’s already a request about this waiting for Luna’s K9 Club.');

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

// ---- Decide ------------------------------------------------------------------------------

const DecisionInput = z.object({ reason: optionalText(1000) });

async function decide(
  db: Db,
  actor: Actor,
  rawId: string,
  decision: ApprovalDecision,
  opts: { reason: string | null; now: Date; ownCustomerOnly?: string },
) {
  await ensureTypesLoaded();
  const id = idOrNotFound(rawId, 'Request');
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(approvalRequests).where(eq(approvalRequests.id, id)).for('update');
    // A customer only ever sees their own requests; anything else simply doesn't exist for them.
    if (!row || (opts.ownCustomerOnly && row.customerId !== opts.ownCustomerOnly)) throw new NotFoundError('Request');
    const next = nextStatus(row.status, decision);
    if (!next)
      throw new ConflictError(
        `This request has already been ${OUTCOME_TEXT[row.status as Exclude<ApprovalStatus, 'pending'>]}.`,
      );
    const def = requireType(row.type);
    const record = toRecord(row, checkedPayload(def, row));
    const ctx: ApprovalHandlerContext = { tx, actor, now: opts.now, reason: opts.reason };
    if (decision === 'approve') await def.onApprove(ctx, record);
    else if (decision === 'reject') await def.onReject(ctx, record);
    else if (decision === 'withdraw') await def.onWithdraw?.(ctx, record);
    else await def.onExpire?.(ctx, record);
    const [updated] = await tx
      .update(approvalRequests)
      .set({
        status: next,
        decidedBy: actor.kind === 'user' ? actor.userId : null,
        decidedAt: opts.now,
        reason: decision === 'approve' || decision === 'reject' ? opts.reason : null,
      })
      .where(and(eq(approvalRequests.id, row.id), eq(approvalRequests.status, 'pending')))
      .returning();
    if (!updated) throw new ConflictError('This request changed. Please reload.');
    await recordAudit(tx, {
      actor,
      action: `approval.${next}`,
      entityType: 'approval_request',
      entityId: row.id,
      metadata: { type: row.type, hasReason: Boolean(opts.reason) },
    });
    return { def, record: toRecord(updated, record.payload) };
  });

  // After commit: the type's own follow-up (checkouts, its own emails), then the generic email.
  const { def, record } = result;
  const after = def.afterCommit?.[decision];
  if (after) {
    try {
      await after(db, record);
    } catch (err) {
      logger.error(
        { type: record.type, decision, err: err instanceof Error ? err.name : 'unknown' },
        'approval follow-up failed',
      );
    }
  }
  const outcome = DECISION_RESULT[decision];
  if (!skipsGenericEmail(def.skipGenericCustomerEmail, outcome)) await emailCustomer(db, def, record, outcome);
  return { id: record.id, status: record.status };
}

async function emailCustomer(
  db: Db,
  def: ApprovalType<unknown>,
  record: ApprovalRecord<unknown>,
  outcome: Exclude<ApprovalStatus, 'pending'>,
) {
  const [who] = await db
    .select({ email: users.email, name: users.name, anonymisedAt: customers.anonymisedAt })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, record.customerId));
  if (!who || who.anonymisedAt) return;
  let summary = 'Request details are in your account.';
  try {
    summary = clampSummary(def.describe(record.payload));
  } catch {
    // keep the standard wording
  }
  await sendSafely(
    approvalDecisionMessage(
      who.email,
      firstNameOf(who.name),
      { label: def.label, summary, outcome },
      appUrl(def.customerPath ?? '/account'),
    ),
  );
}

/** Owner approves a pending request, with an optional note (portal only). */
export async function approveApprovalRequest(
  db: Db,
  actor: Actor,
  rawId: string,
  input: unknown = {},
  now = new Date(),
) {
  assertAuthorized(actor, 'approvals.manage');
  const { reason } = parseInput(DecisionInput, input);
  return decide(db, actor, rawId, 'approve', { reason, now });
}

/** Owner declines a pending request, with an optional note (portal only; the email uses standard wording). */
export async function rejectApprovalRequest(
  db: Db,
  actor: Actor,
  rawId: string,
  input: unknown = {},
  now = new Date(),
) {
  assertAuthorized(actor, 'approvals.manage');
  const { reason } = parseInput(DecisionInput, input);
  return decide(db, actor, rawId, 'reject', { reason, now });
}

/** Customer withdraws one of their own pending requests. */
export async function withdrawMyApprovalRequest(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'approvals.self.manage', { ownerUserId: customer.userId });
  return decide(db, me, rawId, 'withdraw', { reason: null, now, ownCustomerOnly: customer.id });
}

/** Scheduler (or the Owner's "run jobs"): close a pending request nobody answered in time. */
export async function expireApprovalRequest(db: Db, actor: Actor, rawId: string, now = new Date()) {
  assertAuthorized(actor, 'jobs.run');
  return decide(db, actor, rawId, 'expire', { reason: null, now });
}

// ---- Lists -------------------------------------------------------------------------------

export type CustomerApprovalItem = {
  id: string;
  type: string;
  label: string;
  subjectKey: string;
  summary: string;
  status: ApprovalStatus;
  createdAt: Date;
  decidedAt: Date | null;
  /** The Owner's note, shown in the portal (never emailed). */
  reason: string | null;
};

/** The signed-in customer's own requests (pending by default), newest first. */
export async function myApprovalRequests(
  db: Db,
  actor: Actor,
  opts: { status?: ApprovalStatus | 'all'; type?: string } = {},
): Promise<CustomerApprovalItem[]> {
  await ensureTypesLoaded();
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'approvals.self.manage', { ownerUserId: customer.userId });
  const status = opts.status ?? 'pending';
  const rows = await db
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.customerId, customer.id),
        status === 'all' ? undefined : eq(approvalRequests.status, status),
        opts.type ? eq(approvalRequests.type, opts.type) : undefined,
      ),
    )
    .orderBy(desc(approvalRequests.createdAt))
    .limit(200);
  return rows.map((r) => {
    const def = registry.get(r.type);
    return {
      id: r.id,
      type: r.type,
      label: def?.label ?? 'Request',
      subjectKey: r.subjectKey,
      summary: summaryOf(def, r),
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      reason: r.reason,
    };
  });
}

/** The signed-in customer's pending requests. */
export function myPendingApprovals(db: Db, actor: Actor, opts: { type?: string } = {}) {
  return myApprovalRequests(db, actor, { ...opts, status: 'pending' });
}

export type OwnerApprovalItem = CustomerApprovalItem & {
  customerId: string;
  customerName: string;
  /** From the type's optional ownerContext loader, e.g. the other dogs booked that day. */
  context: OwnerContextSection[];
};

/**
 * The Owner's approvals list across every type. Pending requests oldest first (fair order);
 * any other status newest first.
 */
export async function ownerApprovalList(
  db: Db,
  actor: Actor,
  opts: { status?: ApprovalStatus | 'all'; type?: string; limit?: number } = {},
): Promise<OwnerApprovalItem[]> {
  assertAuthorized(actor, 'approvals.manage');
  await ensureTypesLoaded();
  const status = opts.status ?? 'pending';
  const where: (SQL | undefined)[] = [
    status === 'all' ? undefined : eq(approvalRequests.status, status),
    opts.type ? eq(approvalRequests.type, opts.type) : undefined,
  ];
  const rows = await db
    .select({ r: approvalRequests, customerName: users.name })
    .from(approvalRequests)
    .innerJoin(customers, eq(customers.id, approvalRequests.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(...where))
    .orderBy(status === 'pending' ? asc(approvalRequests.createdAt) : desc(approvalRequests.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 500));

  // One ownerContext call per type for the whole page.
  const context = new Map<string, OwnerContextSection[]>();
  const byType = new Map<string, ApprovalRecord<unknown>[]>();
  for (const { r } of rows) {
    const def = registry.get(r.type);
    if (!def?.ownerContext) continue;
    const parsed = def.schema.safeParse(r.payload);
    if (!parsed.success) continue;
    byType.set(r.type, [...(byType.get(r.type) ?? []), toRecord(r, parsed.data)]);
  }
  for (const [type, records] of byType) {
    try {
      const m = await registry.get(type)!.ownerContext!(db, records);
      for (const [id, sections] of m) context.set(id, sections);
    } catch (err) {
      logger.error({ type, err: err instanceof Error ? err.name : 'unknown' }, 'approval context failed');
    }
  }

  return rows.map(({ r, customerName }) => {
    const def = registry.get(r.type);
    return {
      id: r.id,
      type: r.type,
      label: def?.label ?? r.type,
      subjectKey: r.subjectKey,
      summary: summaryOf(def, r),
      status: r.status,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      reason: r.reason,
      customerId: r.customerId,
      customerName,
      context: context.get(r.id) ?? [],
    };
  });
}

/** Number of requests waiting for the Owner (dashboard, nav). */
export async function pendingApprovalCount(db: Db, actor: Actor, opts: { types?: string[] } = {}): Promise<number> {
  assertAuthorized(actor, 'approvals.manage');
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.status, 'pending'),
        opts.types?.length ? inArray(approvalRequests.type, opts.types) : undefined,
      ),
    );
  return row?.n ?? 0;
}
