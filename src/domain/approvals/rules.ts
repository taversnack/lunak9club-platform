/**
 * Pure rules for approval requests (D77). No I/O.
 *
 * A request starts `pending`. The Owner approves or rejects it, the customer can withdraw it,
 * and the scheduler can expire it. Every decision is final: nothing moves out of a decided state.
 */

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'expired'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** What can happen to a request, and who may do it. */
export const APPROVAL_DECISIONS = ['approve', 'reject', 'withdraw', 'expire'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

/** The status each decision leads to. */
export const DECISION_RESULT: Readonly<Record<ApprovalDecision, Exclude<ApprovalStatus, 'pending'>>> = {
  approve: 'approved',
  reject: 'rejected',
  withdraw: 'withdrawn',
  expire: 'expired',
};

/** Who makes each decision: the Owner (approvals.manage), the customer themselves, or the scheduler. */
export const DECISION_BY: Readonly<Record<ApprovalDecision, 'owner' | 'customer' | 'system'>> = {
  approve: 'owner',
  reject: 'owner',
  withdraw: 'customer',
  expire: 'system',
};

export function isApprovalStatus(s: string): s is ApprovalStatus {
  return (APPROVAL_STATUSES as readonly string[]).includes(s);
}

/** Only pending requests can be decided; decided requests never change again. */
export function canDecide(status: ApprovalStatus): boolean {
  return status === 'pending';
}

/** The status after `decision`, or null if the request can't take that decision any more. */
export function nextStatus(status: ApprovalStatus, decision: ApprovalDecision): ApprovalStatus | null {
  return canDecide(status) ? DECISION_RESULT[decision] : null;
}

/** Request types are dotted lower-case names, e.g. `booking.request`, `membership.days`. */
export const APPROVAL_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isValidApprovalType(type: string): boolean {
  return type.length <= 60 && APPROVAL_TYPE_PATTERN.test(type);
}

/**
 * Subject keys name what a request is about, as `<kind>:<id>` (e.g. `booking:<uuid>`,
 * `membership:<uuid>`). Only one request per (type, subject) can be pending at a time.
 */
export const SUBJECT_KEY_PATTERN = /^[a-z][a-z0-9_]*:[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;

export function isValidSubjectKey(key: string): boolean {
  return SUBJECT_KEY_PATTERN.test(key);
}

export function subjectKey(kind: string, id: string): string {
  const key = `${kind}:${id}`;
  if (!isValidSubjectKey(key)) throw new Error(`Invalid approval subject key: ${kind}:…`);
  return key;
}

/** describe() output is shown to the Owner and put in emails, so it is kept short (and must not be sensitive). */
export const SUMMARY_MAX = 200;

export function clampSummary(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX - 1)}…` : t;
}

/** Customer-facing words for each outcome (generic emails and the portal). */
export const OUTCOME_TEXT: Readonly<Record<Exclude<ApprovalStatus, 'pending'>, string>> = {
  approved: 'approved',
  rejected: 'not approved',
  withdrawn: 'withdrawn',
  expired: 'no longer open',
};
