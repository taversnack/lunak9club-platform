import type { ZodType } from 'zod';
import type { ApprovalDecision, ApprovalStatus } from './rules';

/** A request as handlers see it: the stored row with its payload already checked by the type's schema. */
export type ApprovalRecord<P> = {
  id: string;
  type: string;
  customerId: string;
  subjectKey: string;
  payload: P;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Extra facts shown to the Owner beside a request (e.g. the other dogs booked that day). Plain text,
 * plus optional links to Owner pages (relative `/admin/…` paths only).
 */
export type OwnerContextSection = { heading: string; lines: string[]; links?: { label: string; href: string }[] };

/** Generic customer emails that a type can switch off (because it sends its own, e.g. a payment link). */
export type GenericCustomerEmail = Exclude<ApprovalStatus, 'pending'>;

/**
 * The shape of an approval type (D77). Infrastructure-free: the server layer fills in
 * `Ctx` (transaction, actor, time, Owner note) and `Q` (database handle) – see
 * src/server/services/approvals.ts, which exports the concrete `ApprovalType<P>`.
 */
export interface ApprovalTypeShape<P, Ctx, Q> {
  /** Dotted name, e.g. `booking.request`. Unique across the app. */
  type: string;
  /** What the Owner and customer call it, e.g. "Booking request". */
  label: string;
  /**
   * How emails name one request, read after "your", "a" and "new", lower case: e.g. "booking request",
   * "membership days request", "request to move a membership day". Not the label – labels are list headings
   * ("Move a membership day") and don't read as nouns in a sentence.
   */
  emailNoun: string;
  /** Validates the payload on create and again before every decision. */
  schema: ZodType<P>;
  /** A short summary for the Owner list and emails. Never sensitive (no health, behaviour, notes or contact data). */
  describe(payload: P): string;
  /** Where the customer sees this request (generic emails link here). Defaults to `/account`. */
  customerPath?: string;

  /** Inside the decision's transaction. Throw to refuse (the request stays pending). */
  onApprove(ctx: Ctx, request: ApprovalRecord<P>): Promise<void>;
  onReject(ctx: Ctx, request: ApprovalRecord<P>): Promise<void>;
  /** Optional: undo side effects when the customer withdraws or the scheduler expires the request. */
  onWithdraw?(ctx: Ctx, request: ApprovalRecord<P>): Promise<void>;
  onExpire?(ctx: Ctx, request: ApprovalRecord<P>): Promise<void>;

  /** Optional: run after the decision has committed (card checkouts, the type's own emails). Failures are logged, never undo the decision. */
  afterCommit?: Partial<Record<ApprovalDecision, (db: Q, request: ApprovalRecord<P>) => Promise<void>>>;

  /** Skip the generic customer email for every outcome (true) or the listed ones. */
  skipGenericCustomerEmail?: boolean | readonly GenericCustomerEmail[];

  /** Optional: extra facts for the Owner list, loaded once per page for all of this type's requests. */
  ownerContext?(db: Q, requests: readonly ApprovalRecord<P>[]): Promise<Map<string, OwnerContextSection[]>>;
}

export function skipsGenericEmail(
  flag: boolean | readonly GenericCustomerEmail[] | undefined,
  outcome: GenericCustomerEmail,
): boolean {
  if (!flag) return false;
  return flag === true || flag.includes(outcome);
}
