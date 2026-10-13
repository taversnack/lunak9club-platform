import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../src/infra/db/client';
import { checkoutAttempts } from '../../src/infra/db/schema';
import type { Actor } from '../../src/server/policy/authorize';
import { createMyBookings } from '../../src/server/services/bookings';
import { approveApprovalRequest } from '../../src/server/services/approvals';

/**
 * Customer requests days (D76) and the Owner approves at once (D77). Returns the outcomes as they
 * stand after approval ('confirmed' = got a place) plus the checkout opened for priced days, so
 * tests written for the old "book and pay" flow keep their meaning.
 */
export async function requestAndApprove(db: Db, customer: Actor, input: unknown, owner: Actor, now = new Date()) {
  const r = await createMyBookings(db, customer, input, now);
  if (r.requestId) await approveApprovalRequest(db, owner, r.requestId, {}, now);
  const [checkout] = await db
    .select({ url: checkoutAttempts.url, expiresAt: checkoutAttempts.expiresAt })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.bookingId, r.bookingId), eq(checkoutAttempts.status, 'open')))
    .orderBy(desc(checkoutAttempts.createdAt));
  return {
    ...r,
    outcomes: r.outcomes.map((o) => ({
      ...o,
      outcome: o.outcome === 'requested' ? ('confirmed' as const) : o.outcome,
    })),
    checkoutUrl: checkout?.url ?? null,
    holdUntil: checkout?.expiresAt ?? null,
  };
}
