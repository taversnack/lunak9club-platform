import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { bookingDogs, customers, dogs, membershipOffers } from '@/infra/db/schema';
import { cancellationTerms, checkBookableDate, fits, type Session } from '@/domain/booking/rules';
import { moveOnceProblem } from '@/domain/membership/rules';
import { addDays, formatUkDate, londonDate, type IsoDate } from '@/domain/time';
import { ConflictError } from '../errors';
import { recordAudit } from '../audit';
import { registerApprovalType, type ApprovalHandlerContext, type Tx } from './approvals';
import { closuresBetween, loadSettings, lockDays } from './booking-shared';
import { refreshMembershipDrafts } from './billing';
import { HORIZON_DAYS, materialiseMemberships } from './memberships';
import {
  changeStartFor,
  currentMembership,
  describePlan,
  fullDatesFor,
  fullDatesMessage,
  SESSION_WORDS,
  setMembershipDaysTx,
} from './membership-days';

/**
 * Approval types for membership days (D89, D90), registered with Developer 2's generic approval
 * requests (D77). The Owner decides in /admin/approvals; the generic emails use standard wording
 * and the Owner's note shows only in the customer's account.
 */

const SYSTEM = { kind: 'system', job: 'membership-approvals' } as const;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const session = z.enum(['full', 'am', 'pm']);

// ---- membership.days: choose or change a dog's regular days ---------------------------------

export const MembershipDaysPayload = z.object({
  dogId: z.string().uuid(),
  dogName: z.string().min(1).max(60),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  session,
  taxi: z.boolean(),
  /** New membership: the start the customer chose. Change: the first month not yet invoiced (D89). */
  startsOn: isoDay,
  change: z.boolean(),
  /** The Owner's offer this request replaces (D87), if any. */
  offerId: z.string().uuid().nullable(),
});
export type MembershipDaysPayload = z.infer<typeof MembershipDaysPayload>;

/** Re-checks the dog and works out the start date at decision time (it may have moved on since the request). */
async function daysStart(tx: Tx, customerId: string, p: MembershipDaysPayload, now: Date): Promise<IsoDate> {
  const [dog] = await tx
    .select({ id: dogs.id })
    .from(dogs)
    .where(and(eq(dogs.id, p.dogId), eq(dogs.customerId, customerId), isNull(dogs.archivedAt)));
  if (!dog) throw new ConflictError('This dog is no longer on the customer’s account.');
  const tomorrow = addDays(londonDate(now), 1);
  const current = await currentMembership(tx, p.dogId, londonDate(now));
  let start = p.startsOn < tomorrow ? tomorrow : p.startsOn;
  if (current) {
    const next = await changeStartFor(tx, customerId, now);
    if (start < next) start = next;
  }
  return start;
}

registerApprovalType<MembershipDaysPayload>({
  type: 'membership.days',
  label: 'Membership days',
  emailNoun: 'membership days request',
  schema: MembershipDaysPayload,
  customerPath: '/account/membership',
  describe: (p) =>
    `${p.dogName}: ${p.change ? 'change to ' : ''}${describePlan({ weekdays: p.weekdays, session: p.session as Session, taxi: p.taxi }, p.startsOn)}`,
  async onApprove(ctx: ApprovalHandlerContext, req) {
    const p = req.payload;
    const startsOn = await daysStart(ctx.tx, req.customerId, p, ctx.now);
    const plan = { weekdays: p.weekdays, session: p.session as Session, taxi: p.taxi };
    const full = await fullDatesFor(ctx.tx, p.dogId, plan, startsOn, ctx.now);
    if (full.length) throw new ConflictError(fullDatesMessage(full));
    const [requester] = await ctx.tx
      .select({ userId: customers.userId })
      .from(customers)
      .where(eq(customers.id, req.customerId));
    await setMembershipDaysTx(ctx.tx, ctx.actor, {
      ...plan,
      customerId: req.customerId,
      dogId: p.dogId,
      startsOn,
      requestedBy: requester!.userId,
      now: ctx.now,
      source: 'request',
    });
    if (p.offerId)
      await ctx.tx
        .update(membershipOffers)
        .set({ closedAt: ctx.now, dogId: p.dogId })
        .where(and(eq(membershipOffers.id, p.offerId), isNull(membershipOffers.closedAt)));
  },
  // Rejected: the dog keeps its current days (or none yet). The note shows in the account only.
  async onReject() {},
  afterCommit: {
    approve: async (db, req) => {
      const p = req.payload as MembershipDaysPayload;
      const m = await currentMembership(db, p.dogId, londonDate(new Date()));
      await materialiseMemberships(db, SYSTEM, m ? { membershipId: m.id } : {});
      await refreshMembershipDrafts(db, SYSTEM, { customerId: req.customerId });
    },
  },
});

// ---- membership.move_once: move one membership day, this occasion only ------------------------

export const MoveOncePayload = z.object({
  bookingDogId: z.string().uuid(),
  dogId: z.string().uuid(),
  dogName: z.string().min(1).max(60),
  fromDate: isoDay,
  toDate: isoDay,
  session,
});
export type MoveOncePayload = z.infer<typeof MoveOncePayload>;

/**
 * Checks a one-off move (D90): a membership day of this dog, still booked, moved inside the same
 * month with at least the free-cancellation notice, to an open day the dog doesn't already have,
 * with space for the same session and taxi. Locks the target day. Returns the booked row.
 */
export async function checkMoveOnce(tx: Tx, customerId: string, p: MoveOncePayload, now: Date) {
  const [bd] = await tx
    .select()
    .from(bookingDogs)
    .where(and(eq(bookingDogs.id, p.bookingDogId), eq(bookingDogs.customerId, customerId)))
    .for('update');
  if (!bd || bd.kind !== 'membership' || bd.status !== 'confirmed' || bd.serviceDate !== p.fromDate)
    throw new ConflictError('This membership day can’t be moved any more – it has changed since the request.');
  const settings = await loadSettings(tx);
  const today = londonDate(now);
  const problem = moveOnceProblem(p.fromDate, p.toDate, today);
  if (problem) throw new ConflictError(problem);
  if (cancellationTerms(now, p.fromDate, bd.session as Session, settings).late)
    throw new ConflictError(
      `A day can only be moved at least ${settings.freeCancellationHours} hours before it starts.`,
    );
  const closed = await closuresBetween(tx, p.toDate, p.toDate);
  const open = checkBookableDate({
    date: p.toDate,
    today,
    settings: { ...settings, maxAdvanceDays: HORIZON_DAYS },
    closedReason: closed.get(p.toDate),
  });
  if (!open.ok) throw new ConflictError(open.reason);
  const [clash] = await tx
    .select({ id: bookingDogs.id })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.dogId, bd.dogId),
        eq(bookingDogs.serviceDate, p.toDate),
        inArray(bookingDogs.status, ['confirmed', 'pending_payment', 'waitlisted', 'requested', 'attended', 'no_show']),
      ),
    );
  if (clash) throw new ConflictError(`${p.dogName} is already booked on ${formatUkDate(p.toDate)}.`);
  const day = (await lockDays(tx, [p.toDate], settings, now)).get(p.toDate)!;
  if (!fits(bd.session as Session, bd.taxi, day.used, day.cap).ok)
    throw new ConflictError(`There’s no space on ${formatUkDate(p.toDate)}. Choose another day.`);
  return bd;
}

registerApprovalType<MoveOncePayload>({
  type: 'membership.move_once',
  label: 'Move a membership day',
  emailNoun: 'request to move a membership day',
  schema: MoveOncePayload,
  customerPath: '/account/bookings',
  describe: (p) =>
    `${p.dogName}: move ${SESSION_WORDS[p.session as Session]} on ${formatUkDate(p.fromDate)} to ${formatUkDate(p.toDate)} (this occasion only)`,
  async onApprove(ctx, req) {
    const p = req.payload;
    await checkMoveOnce(ctx.tx, req.customerId, p, ctx.now);
    // Straight swap (D90): same booking, price snapshot and invoice; only the date changes.
    await ctx.tx.update(bookingDogs).set({ serviceDate: p.toDate }).where(eq(bookingDogs.id, p.bookingDogId));
    await recordAudit(ctx.tx, {
      actor: ctx.actor,
      action: 'membership.day_moved',
      entityType: 'booking_dog',
      entityId: p.bookingDogId,
      metadata: { from: p.fromDate, to: p.toDate },
    });
  },
  async onReject() {},
});
