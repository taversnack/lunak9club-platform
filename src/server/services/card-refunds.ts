import 'server-only';
import { and, asc, eq, inArray, isNull, lt, ne, or, sql, sum } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { cardRefunds, creditNotes, customers, invoices, payments, users } from '@/infra/db/schema';
import { pounds } from '@/domain/pricing/engine';
import { getPaymentProvider } from '@/infra/payments';
import { logger } from '@/infra/logger';
import { cardRefundMessage, ownerBillingMessage } from '@/infra/email/templates';
import { londonDate } from '@/domain/time';
import { appUrl, firstNameOf, ownerEmails, sendSafely } from '../notify';
import { claimNotification } from './reminders';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError } from '../errors';
import { idOrNotFound } from '../validation';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

const SYSTEM: Actor = { kind: 'system', job: 'card-refunds' };

/**
 * Queue money back to the card(s) that paid an invoice (D58), inside the caller's transaction.
 * Only card payments can be refunded here; anything paid another way stays for the Owner to
 * return by hand. Returns how much was queued.
 */
export async function queueCardRefunds(
  tx: Tx,
  opts: { invoiceId: string; amountPence: number; creditNoteId: string | null; reason: string },
): Promise<number> {
  if (opts.amountPence <= 0) return 0;
  const cardPayments = await tx
    .select({ id: payments.id, amountPence: payments.amountPence })
    .from(payments)
    .where(and(eq(payments.invoiceId, opts.invoiceId), eq(payments.method, 'stripe')))
    .orderBy(asc(payments.createdAt))
    .for('update');
  if (!cardPayments.length) return 0;
  const already = await tx
    .select({ paymentId: cardRefunds.paymentId, amount: sum(cardRefunds.amountPence).mapWith(Number) })
    .from(cardRefunds)
    .where(
      and(
        inArray(
          cardRefunds.paymentId,
          cardPayments.map((p) => p.id),
        ),
        ne(cardRefunds.status, 'failed'),
      ),
    )
    .groupBy(cardRefunds.paymentId);
  const used = new Map(already.map((a) => [a.paymentId, a.amount]));
  let left = opts.amountPence;
  let queued = 0;
  for (const p of cardPayments) {
    if (left <= 0) break;
    const room = p.amountPence - (used.get(p.id) ?? 0);
    if (room <= 0) continue;
    const take = Math.min(room, left);
    await tx.insert(cardRefunds).values({
      paymentId: p.id,
      creditNoteId: opts.creditNoteId,
      amountPence: take,
      reason: opts.reason,
    });
    left -= take;
    queued += take;
  }
  return queued;
}

/** Mark a credit note refunded once card refunds covering its refund-due amount have all succeeded. */
async function maybeCloseCreditNote(q: Q, creditNoteId: string | null) {
  if (!creditNoteId) return;
  const [cn] = await q.select().from(creditNotes).where(eq(creditNotes.id, creditNoteId));
  if (!cn || cn.refundState !== 'awaiting_refund') return;
  const [done] = await q
    .select({ amount: sum(cardRefunds.amountPence).mapWith(Number) })
    .from(cardRefunds)
    .where(and(eq(cardRefunds.creditNoteId, creditNoteId), eq(cardRefunds.status, 'succeeded')));
  if ((done?.amount ?? 0) >= cn.refundDuePence)
    await q.update(creditNotes).set({ refundState: 'refunded' }).where(eq(creditNotes.id, creditNoteId));
}

/**
 * Send queued refunds to the payment provider. Safe to call repeatedly: each attempt has its own
 * idempotency key (our id, plus the attempt number from the second attempt on), so the provider
 * never pays out twice for one attempt, while a retry after a failure really sends the money again. Called after the queuing transaction
 * commits, and by the scheduler as a safety net.
 */
export async function submitPendingRefunds(db: Db, opts: { ids?: string[] } = {}) {
  const staleBefore = new Date(Date.now() - STALE_SUBMIT_MS);
  const rows = await db
    .select({ r: cardRefunds, providerPaymentId: payments.providerPaymentId })
    .from(cardRefunds)
    .innerJoin(payments, eq(payments.id, cardRefunds.paymentId))
    .where(
      opts.ids
        ? and(inArray(cardRefunds.id, opts.ids), inArray(cardRefunds.status, ['requested', 'failed']))
        : or(
            eq(cardRefunds.status, 'requested'),
            // Interrupted mid-submit: safe to resend because the idempotency key is the same.
            and(
              eq(cardRefunds.status, 'submitted'),
              isNull(cardRefunds.providerRefundId),
              lt(cardRefunds.updatedAt, staleBefore),
            ),
          ),
    )
    .orderBy(asc(cardRefunds.createdAt))
    .limit(100);
  const provider = getPaymentProvider();
  let succeeded = 0;
  let failed = 0;
  let claimedCount = 0;
  let accountProblem = false;
  for (const { r, providerPaymentId } of rows) {
    // Claim it so two runs don't submit at the same moment. A new or failed refund starts a new
    // attempt (a failed provider refund is finished, so retrying needs a new one with a new key); one
    // interrupted mid-submit resends the same attempt with the same key, so the provider dedupes it.
    // The claim re-checks everything that made the row eligible, in one conditional update, and
    // moves updated_at on: a stale 'submitted' row stays 'submitted', so checking the status alone
    // let every concurrent tick claim it (and audit it) again.
    const resend = r.status === 'submitted';
    const [claimed] = await db
      .update(cardRefunds)
      .set({
        status: 'submitted',
        updatedAt: new Date(),
        ...(resend ? {} : { attempts: sql`${cardRefunds.attempts} + 1`, providerRefundId: null }),
      })
      .where(
        and(
          eq(cardRefunds.id, r.id),
          eq(cardRefunds.status, r.status),
          resend ? and(isNull(cardRefunds.providerRefundId), lt(cardRefunds.updatedAt, staleBefore)) : undefined,
        ),
      )
      .returning({ id: cardRefunds.id, attempts: cardRefunds.attempts });
    if (!claimed || !providerPaymentId) continue;
    claimedCount++;
    const attempt = Math.max(claimed.attempts, 1);
    const key = attempt > 1 ? `refund-${r.id}-${attempt}` : `refund-${r.id}`;
    const res = await provider.refund(providerPaymentId, r.amountPence, key, r.id, attempt);
    // 'pending' with no id means we don't know whether it went through: it stays 'submitted' with no
    // provider id, so the safety net above sends it again (the provider dedupes) or the webhook,
    // matched on our id, settles it.
    const status = res.status === 'succeeded' ? 'succeeded' : res.status === 'failed' ? 'failed' : 'submitted';
    const [saved] = await db
      .update(cardRefunds)
      .set({ status, failureReason: res.failureReason ?? null, ...(res.id ? { providerRefundId: res.id } : {}) })
      // A webhook may have settled it (or recorded its id) while we waited: don't undo that, and
      // don't audit it twice (the webhook wrote its own entry).
      .where(and(eq(cardRefunds.id, r.id), eq(cardRefunds.status, 'submitted')))
      .returning({ id: cardRefunds.id });
    if (!saved) continue;
    await recordAudit(db, {
      actor: SYSTEM,
      action: `refund.card_${status}`,
      entityType: 'card_refund',
      entityId: r.id,
      metadata: { amountPence: r.amountPence },
    });
    if (status === 'succeeded') {
      succeeded++;
      await maybeCloseCreditNote(db, r.creditNoteId);
      await emailRefundSent(db, r.id);
    }
    if (status === 'failed') {
      failed++;
      if (res.needsOwner) accountProblem = true;
      logger.warn({ refund: r.id, needsOwner: Boolean(res.needsOwner) }, 'card refund failed');
    }
  }
  if (failed) await tellOwnerRefundsFailed(db, failed, accountProblem);
  return { succeeded, failed, claimed: claimedCount };
}

/** A refund left 'submitted' with no answer this long ago was interrupted, and is sent again. */
const STALE_SUBMIT_MS = 10 * 60_000;

/** Tell the customer their card refund has gone through (once per refund). Best effort. */
async function emailRefundSent(db: Db, refundId: string) {
  try {
    if (!(await claimNotification(db, `card-refund-sent:${refundId}`, 'card-refund-sent'))) return;
    const [row] = await db
      .select({ amountPence: cardRefunds.amountPence, number: invoices.number, email: users.email, name: users.name })
      .from(cardRefunds)
      .innerJoin(payments, eq(payments.id, cardRefunds.paymentId))
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .innerJoin(users, eq(users.id, customers.userId))
      .where(eq(cardRefunds.id, refundId));
    if (!row) return;
    await sendSafely(
      cardRefundMessage(
        row.email,
        firstNameOf(row.name),
        { amountText: pounds(row.amountPence), forText: row.number ? `invoice ${row.number}` : 'your booking' },
        appUrl('/account/invoices'),
      ),
    );
  } catch (err) {
    logger.error({ refund: refundId, err: err instanceof Error ? err.name : 'unknown' }, 'refund email failed');
  }
}

/**
 * Email the Owner that card refunds need attention (at most once a day): they're listed under
 * Refunds with a 'Try again' button. Best effort: the refund state is already saved.
 */
async function tellOwnerRefundsFailed(db: Db, count: number, accountProblem: boolean) {
  try {
    if (!(await claimNotification(db, `card-refunds-failed:${londonDate(new Date())}`, 'card-refunds-failed'))) return;
    const why = accountProblem
      ? 'Stripe refused our API key (it may be wrong, revoked or missing the refunds permission), so no money has been sent. Please check the Stripe key in the server settings, then use Try again on each refund.'
      : 'The card provider rejected them, so no money has been sent. Please check each one and use Try again, or refund the customer another way.';
    for (const to of await ownerEmails(db))
      await sendSafely(
        ownerBillingMessage(
          to,
          'Card refunds need your attention',
          `${count === 1 ? 'A card refund' : `${count} card refunds`} could not be sent. ${why}`,
          appUrl('/admin/refunds'),
        ),
      );
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.name : 'unknown' }, 'refund failure alert failed');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A provider webhook reported the state of a refund. Matched on the provider's refund id, or – if we
 * never learned it (the create call timed out) – on our own id from the refund's metadata.
 */
export async function applyRefundUpdate(
  db: Db,
  providerRefundId: string,
  status: 'succeeded' | 'pending' | 'failed',
  reference?: string,
  attempt?: number,
) {
  // First news of a refund whose create call we never heard back from: record its id, which also
  // stops the safety net from sending it again. Only for the current attempt: late news about an
  // earlier, failed attempt must not attach that old refund again.
  if (reference && UUID.test(reference))
    await db
      .update(cardRefunds)
      .set({ providerRefundId })
      .where(
        and(
          eq(cardRefunds.id, reference),
          isNull(cardRefunds.providerRefundId),
          attempt ? eq(cardRefunds.attempts, attempt) : undefined,
        ),
      );
  if (status === 'pending') return;
  const [r] = await db
    .update(cardRefunds)
    // A success clears any reason left from an earlier failed or timed-out attempt.
    .set(status === 'succeeded' ? { status: 'succeeded', failureReason: null } : { status: 'failed' })
    .where(
      and(
        eq(cardRefunds.providerRefundId, providerRefundId),
        ne(cardRefunds.status, 'succeeded'),
        // A repeat of the same news changes nothing, so it isn't audited again.
        ne(cardRefunds.status, status),
      ),
    )
    .returning();
  if (!r) return;
  await recordAudit(db, {
    actor: SYSTEM,
    action: `refund.card_${r.status}`,
    entityType: 'card_refund',
    entityId: r.id,
    metadata: { amountPence: r.amountPence, via: 'webhook' },
  });
  if (r.status === 'succeeded') {
    await maybeCloseCreditNote(db, r.creditNoteId);
    await emailRefundSent(db, r.id);
  }
}

/** Owner retries a refund the provider rejected. */
export async function retryCardRefund(db: Db, actor: Actor, rawId: string) {
  assertAuthorized(actor, 'refunds.manage');
  const id = idOrNotFound(rawId, 'Refund');
  const [r] = await db.select().from(cardRefunds).where(eq(cardRefunds.id, id));
  if (!r) throw new NotFoundError('Refund');
  if (r.status !== 'failed') throw new ConflictError('Only failed refunds can be tried again.');
  const res = await submitPendingRefunds(db, { ids: [id] });
  // Someone else (another click, or the scheduler) claimed it first: their attempt is the retry.
  if (!res.claimed) throw new ConflictError('This refund is already being tried again.');
  await recordAudit(db, { actor, action: 'refund.card_retry', entityType: 'card_refund', entityId: id });
  return res;
}

/** Owner view of card refunds: failed ones (to retry) and the most recent. */
export async function ownerCardRefunds(db: Db, actor: Actor) {
  assertAuthorized(actor, 'refunds.manage');
  const rows = await db
    .select({ r: cardRefunds, invoiceId: payments.invoiceId })
    .from(cardRefunds)
    .innerJoin(payments, eq(payments.id, cardRefunds.paymentId))
    .orderBy(sql`${cardRefunds.createdAt} desc`)
    .limit(50);
  return { failed: rows.filter((x) => x.r.status === 'failed'), recent: rows.filter((x) => x.r.status !== 'failed') };
}
