import 'server-only';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import { approvalRequests, bookingDogs, customers, dogs, priceSnapshots, users } from '@/infra/db/schema';
import {
  formatPounds,
  PLACE_STATUSES,
  remainingFor,
  SESSION_LABELS,
  vaccinationBlockForDate,
} from '@/domain/booking/rules';
import { subjectKey } from '@/domain/approvals';
import { formatUkDate, londonDate, type IsoDate } from '@/domain/time';
import { bookingSummaryMessage, type BookingLine } from '@/infra/email/templates';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError } from '../errors';
import { appUrl, firstNameOf, sendSafely } from '../notify';
import {
  expireApprovalRequest,
  registerApprovalType,
  type ApprovalHandlerContext,
  type ApprovalRecord,
  type OwnerContextSection,
  type Tx,
} from './approvals';
import { daysOverview, describeSession, loadSettings, lockDays } from './booking-shared';
import { evaluateDogs } from './compliance-facts';
import { ownerHoldUntil, sessionStartInstant, startBookingCheckout } from './payments';

/**
 * booking.request (D76–D80, D83, D85): a customer's ad hoc days, member extra days and trial days
 * wait for the Owner. Rows sit as `requested` (holding their place) until the Owner approves
 * (→ pending_payment with a pay link, or confirmed for £0 / membership days), declines (→ rejected),
 * the customer withdraws (→ cancelled) or the booking cut-off passes (→ cancelled).
 */
export const BOOKING_REQUEST = 'booking.request';

export const BookingRequestPayload = z.object({
  bookingId: z.string().uuid(),
  bookingDogIds: z.array(z.string().uuid()).min(1),
  kind: z.enum(['standard', 'trial']),
  totalPence: z.number().int().min(0),
});
export type BookingRequestPayload = z.infer<typeof BookingRequestPayload>;

export const bookingSubjectKey = (bookingId: string) => subjectKey('booking', bookingId);

type Q = Db | Tx;

async function requestRows(q: Q, ids: readonly string[], status?: 'requested') {
  if (!ids.length) return [];
  return q
    .select({
      id: bookingDogs.id,
      bookingId: bookingDogs.bookingId,
      customerId: bookingDogs.customerId,
      dogId: bookingDogs.dogId,
      dogName: dogs.name,
      serviceDate: bookingDogs.serviceDate,
      session: bookingDogs.session,
      taxi: bookingDogs.taxi,
      kind: bookingDogs.kind,
      status: bookingDogs.status,
      version: bookingDogs.version,
      offerExpiresAt: bookingDogs.offerExpiresAt,
      totalPence: priceSnapshots.totalPence,
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .leftJoin(priceSnapshots, eq(priceSnapshots.bookingDogId, bookingDogs.id))
    .where(and(inArray(bookingDogs.id, [...ids]), status ? eq(bookingDogs.status, status) : undefined))
    .orderBy(asc(bookingDogs.serviceDate), asc(dogs.name));
}

const userOf = (actor: Actor) => (actor.kind === 'user' ? actor.userId : null);

async function setRequested(
  ctx: ApprovalHandlerContext,
  req: ApprovalRecord<BookingRequestPayload>,
  to: 'rejected' | 'cancelled',
  note: string,
) {
  const rows = await ctx.tx
    .update(bookingDogs)
    .set(
      to === 'cancelled'
        ? { status: 'cancelled', cancelledAt: ctx.now, cancelledBy: userOf(ctx.actor), lateCancellation: false }
        : { status: 'rejected' },
    )
    .where(and(inArray(bookingDogs.id, req.payload.bookingDogIds), eq(bookingDogs.status, 'requested')))
    .returning({ id: bookingDogs.id });
  await recordAudit(ctx.tx, {
    actor: ctx.actor,
    action: `booking.request_${to}`,
    entityType: 'booking',
    entityId: req.payload.bookingId,
    metadata: { days: rows.length, note },
  });
}

registerApprovalType<BookingRequestPayload>({
  type: BOOKING_REQUEST,
  label: 'Booking request',
  customerPath: '/account/bookings',
  schema: BookingRequestPayload,
  describe: (p) =>
    `${p.kind === 'trial' ? 'Trial day' : 'Day care'} · ${p.bookingDogIds.length} ${p.bookingDogIds.length === 1 ? 'dog-day' : 'dog-days'} · ${formatPounds(p.totalPence)}`,
  // The approval sends its own pay-link or booked email (D80).
  skipGenericCustomerEmail: ['approved'],

  async onApprove(ctx, req) {
    const settings = await loadSettings(ctx.tx);
    const rows = await requestRows(ctx.tx, req.payload.bookingDogIds, 'requested');
    if (!rows.length)
      throw new ConflictError('Every day in this request has been declined or cancelled. Decline the request instead.');
    await lockDays(ctx.tx, [...new Set(rows.map((r) => r.serviceDate))], settings, ctx.now);
    // Vaccinations may have run out since the request was sent (D40).
    // evaluateDogs reads only; the transaction handle offers the same query API as Db.
    const evals = await evaluateDogs(ctx.tx as unknown as Db, [...new Set(rows.map((r) => r.dogId))], ctx.now);
    for (const r of rows) {
      const e = evals.get(r.dogId);
      const block = e
        ? vaccinationBlockForDate(
            e.items.filter((i) => i.kind === 'vaccination'),
            r.serviceDate,
          )
        : null;
      if (block)
        throw new ConflictError(
          `${r.dogName} on ${formatUkDate(r.serviceDate)}: ${block} Decline that day first, or ask the customer to update the record.`,
        );
    }
    // £0 days and membership days skip payment (D83); priced days are held for payment (D78).
    const priced = rows.filter((r) => r.kind !== 'membership' && (r.totalPence ?? 0) > 0);
    const free = rows.filter((r) => !priced.includes(r));
    const hold = priced.length
      ? priced
          .map((r) => ownerHoldUntil(ctx.now, sessionStartInstant(settings, r.serviceDate, r.session)))
          .reduce((a, b) => (a < b ? a : b))
      : null;
    if (priced.length)
      await ctx.tx
        .update(bookingDogs)
        .set({ status: 'pending_payment', offerExpiresAt: hold })
        .where(
          and(
            inArray(
              bookingDogs.id,
              priced.map((r) => r.id),
            ),
            eq(bookingDogs.status, 'requested'),
          ),
        );
    if (free.length)
      await ctx.tx
        .update(bookingDogs)
        .set({ status: 'confirmed', offerExpiresAt: null })
        .where(
          and(
            inArray(
              bookingDogs.id,
              free.map((r) => r.id),
            ),
            eq(bookingDogs.status, 'requested'),
          ),
        );
    await recordAudit(ctx.tx, {
      actor: ctx.actor,
      action: 'booking.request_approved',
      entityType: 'booking',
      entityId: req.payload.bookingId,
      metadata: { held: priced.length, confirmed: free.length },
    });
  },
  onReject: (ctx, req) => setRequested(ctx, req, 'rejected', 'declined'),
  onWithdraw: (ctx, req) => setRequested(ctx, req, 'cancelled', 'withdrawn'),
  onExpire: (ctx, req) => setRequested(ctx, req, 'cancelled', 'expired'),

  afterCommit: {
    async approve(db, req) {
      const rows = await requestRows(db, req.payload.bookingDogIds);
      const held = rows.filter((r) => r.status === 'pending_payment' && r.offerExpiresAt);
      if (held.length) {
        const expiresAt = held.map((r) => r.offerExpiresAt!).reduce((a, b) => (a < b ? a : b));
        await startBookingCheckout(db, {
          bookingId: req.payload.bookingId,
          customerId: req.customerId,
          createdBy: null,
          expiresAt,
          notifyByEmail: true,
          approvedRequest: true,
        });
      }
      const confirmed = rows.filter((r) => r.status === 'confirmed');
      if (confirmed.length) {
        const who = await contact(db, req.customerId);
        if (who)
          await sendSafely(
            bookingSummaryMessage(
              who.email,
              firstNameOf(who.name),
              confirmed.map((r) => ({
                dogName: r.dogName,
                ...describeSession(r.serviceDate, r.session),
                outcome: 'approved and booked',
              })),
              appUrl('/account/bookings'),
            ),
          );
      }
    },
  },

  async ownerContext(db, reqs) {
    const out = new Map<string, OwnerContextSection[]>();
    const ids = reqs.flatMap((r) => r.payload.bookingDogIds);
    const rows = await requestRows(db, ids);
    const dates = [...new Set(rows.map((r) => r.serviceDate))].sort();
    const settings = await loadSettings(db);
    const overview = await daysOverview(db, dates, settings);
    const others = dates.length
      ? await db
          .select({
            id: bookingDogs.id,
            dogId: dogs.id,
            dogName: dogs.name,
            serviceDate: bookingDogs.serviceDate,
            session: bookingDogs.session,
            status: bookingDogs.status,
          })
          .from(bookingDogs)
          .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
          .where(and(inArray(bookingDogs.serviceDate, dates), inArray(bookingDogs.status, [...PLACE_STATUSES])))
          .orderBy(asc(dogs.name))
      : [];
    for (const req of reqs) {
      const mine = rows.filter((r) => req.payload.bookingDogIds.includes(r.id));
      const live = mine.filter((r) => r.status === 'requested');
      const sections: OwnerContextSection[] = [
        {
          heading: 'Days requested',
          lines: mine.map(
            (r) =>
              `${r.dogName} – ${formatUkDate(r.serviceDate)}, ${SESSION_LABELS[r.session]}${r.taxi ? ' + taxi' : ''} – ${formatPounds(r.totalPence ?? 0)}${r.kind === 'trial' ? ' (trial day)' : ''}${r.status === 'requested' ? '' : ` (${r.status === 'rejected' ? 'declined' : r.status})`}`,
          ),
          links: [...new Map(mine.map((r) => [r.dogId, r])).values()].map((r) => ({
            label: `${r.dogName}’s record`,
            href: `/admin/dogs/${r.dogId}`,
          })),
        },
      ];
      for (const date of [...new Set(live.map((r) => r.serviceDate))]) {
        const o = overview.get(date);
        const booked = others.filter((x) => x.serviceDate === date && !mine.some((m) => m.id === x.id));
        sections.push({
          heading: `${formatUkDate(date)}: places left and dogs already booked`,
          lines: [
            o
              ? `Places left: ${remainingFor('am', o.used, o.cap)} morning, ${remainingFor('pm', o.used, o.cap)} afternoon, ${o.cap.taxi - o.used.taxi} taxi (this request already counted)`
              : 'Places left: unknown',
            booked.length
              ? `Already booked: ${booked.map((b) => `${b.dogName} (${SESSION_LABELS[b.session]}${b.status === 'requested' ? ', requested' : b.status === 'pending_payment' ? ', awaiting payment' : ''})`).join(', ')}`
              : 'No other dogs booked yet.',
          ],
          links: [
            { label: `Day view for ${formatUkDate(date)}`, href: `/admin/bookings?date=${date}` },
            ...booked.map((b) => ({ label: b.dogName, href: `/admin/dogs/${b.dogId}` })),
          ],
        });
      }
      out.set(req.id, sections);
    }
    return out;
  },
});

async function contact(q: Q, customerId: string) {
  const [row] = await q
    .select({ email: users.email, name: users.name, anonymisedAt: customers.anonymisedAt })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, customerId));
  return row && !row.anonymisedAt ? row : null;
}

/** The pending booking.request for a booking, if any. */
export async function pendingRequestFor(q: Q, bookingId: string) {
  const [row] = await q
    .select({ id: approvalRequests.id, payload: approvalRequests.payload })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.type, BOOKING_REQUEST),
        eq(approvalRequests.subjectKey, bookingSubjectKey(bookingId)),
        eq(approvalRequests.status, 'pending'),
      ),
    );
  return row ?? null;
}

/** Are any days of this booking still waiting for the Owner? */
export async function requestedLeft(q: Q, bookingId: string) {
  const rows = await q
    .select({ id: bookingDogs.id })
    .from(bookingDogs)
    .where(and(eq(bookingDogs.bookingId, bookingId), eq(bookingDogs.status, 'requested')));
  return rows.length;
}

/**
 * Scheduler, every tick (D79): requests close at the booking cut-off (23:59 London the day before).
 * Days past the cut-off are cancelled at no charge; a request with nothing left is expired. The
 * customer gets one email per request.
 */
export async function expireBookingRequests(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'jobs.run');
  const today: IsoDate = londonDate(now);
  const due = await db
    .selectDistinct({ bookingId: bookingDogs.bookingId })
    .from(bookingDogs)
    .where(and(eq(bookingDogs.status, 'requested'), lte(bookingDogs.serviceDate, today)));
  let expired = 0;
  let daysClosed = 0;
  for (const { bookingId } of due) {
    const req = await pendingRequestFor(db, bookingId);
    const all = await db
      .select({ id: bookingDogs.id, serviceDate: bookingDogs.serviceDate })
      .from(bookingDogs)
      .where(and(eq(bookingDogs.bookingId, bookingId), eq(bookingDogs.status, 'requested')));
    const past = all.filter((r) => r.serviceDate <= today);
    if (req && past.length === all.length) {
      // Nothing left to decide: the generic "no longer open" email goes to the customer.
      await expireApprovalRequest(db, actor, req.id, now);
      expired++;
      daysClosed += past.length;
      continue;
    }
    const closed = await db.transaction(async (tx) => {
      const rows = await tx
        .update(bookingDogs)
        .set({ status: 'cancelled', cancelledAt: now, cancelledBy: null, lateCancellation: false })
        .where(
          and(
            inArray(
              bookingDogs.id,
              past.map((r) => r.id),
            ),
            eq(bookingDogs.status, 'requested'),
          ),
        )
        .returning({ id: bookingDogs.id });
      if (rows.length)
        await recordAudit(tx, {
          actor,
          action: 'booking.request_days_closed',
          entityType: 'booking',
          entityId: bookingId,
          metadata: { days: rows.length },
        });
      return requestRows(
        tx,
        rows.map((r) => r.id),
      );
    });
    if (!closed.length) continue;
    daysClosed += closed.length;
    const who = await contact(db, closed[0]!.customerId);
    if (who) {
      const lines: BookingLine[] = closed.map((r) => ({
        dogName: r.dogName,
        ...describeSession(r.serviceDate, r.session),
        outcome: 'request closed – bookings for this day have closed, nothing charged',
      }));
      await sendSafely(bookingSummaryMessage(who.email, firstNameOf(who.name), lines, appUrl('/account/bookings')));
    }
  }
  return { expired, daysClosed };
}
