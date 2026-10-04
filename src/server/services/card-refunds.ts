import 'server-only';
import { and, asc, eq, inArray, isNull, lt, ne, or, sql, sum } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { cardRefunds, creditNotes, payments } from '@/infra/db/schema';
import { getPaymentProvider } from '@/infra/payments';
import { logger } from '@/infra/logger';
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
 * Send queued refunds to the payment provider. Safe to call repeatedly: each refund's id is its
 * idempotency key, so the provider never pays out twice. Called after the queuing transaction
 * commits, and by the scheduler as a safety net.
 */
export async function submitPendingRefunds(db: Db, opts: { ids?: string[] } = {}) {
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
              lt(cardRefunds.updatedAt, new Date(Date.now() - 10 * 60_000)),
            ),
          ),
    )
    .orderBy(asc(cardRefunds.createdAt))
    .limit(100);
  const provider = getPaymentProvider();
  let succeeded = 0;
  let failed = 0;
  for (const { r, providerPaymentId } of rows) {
    // Claim it so two runs don't submit at the same moment (the idempotency key covers retries).
    const [claimed] = await db
      .update(cardRefunds)
      .set({ status: 'submitted', attempts: sql`${cardRefunds.attempts} + 1` })
      .where(and(eq(cardRefunds.id, r.id), eq(cardRefunds.status, r.status)))
      .returning({ id: cardRefunds.id });
    if (!claimed || !providerPaymentId) continue;
    const res = await provider.refund(providerPaymentId, r.amountPence, `refund-${r.id}`);
    const status = res.status === 'succeeded' ? 'succeeded' : res.status === 'failed' ? 'failed' : 'submitted';
    await db
      .update(cardRefunds)
      .set({ status, providerRefundId: res.id || null, failureReason: res.failureReason ?? null })
      .where(eq(cardRefunds.id, r.id));
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
    }
    if (status === 'failed') {
      failed++;
      logger.warn({ refund: r.id }, 'card refund failed');
    }
  }
  return { succeeded, failed };
}

/** A provider webhook reported the final state of a refund. */
export async function applyRefundUpdate(db: Db, providerRefundId: string, status: 'succeeded' | 'pending' | 'failed') {
  if (status === 'pending') return;
  const [r] = await db
    .update(cardRefunds)
    .set({ status: status === 'succeeded' ? 'succeeded' : 'failed' })
    .where(and(eq(cardRefunds.providerRefundId, providerRefundId), ne(cardRefunds.status, 'succeeded')))
    .returning();
  if (r?.status === 'succeeded') await maybeCloseCreditNote(db, r.creditNoteId);
}

/** Owner retries a refund the provider rejected. */
export async function retryCardRefund(db: Db, actor: Actor, rawId: string) {
  assertAuthorized(actor, 'refunds.manage');
  const id = idOrNotFound(rawId, 'Refund');
  const [r] = await db.select().from(cardRefunds).where(eq(cardRefunds.id, id));
  if (!r) throw new NotFoundError('Refund');
  if (r.status !== 'failed') throw new ConflictError('Only failed refunds can be tried again.');
  await recordAudit(db, { actor, action: 'refund.card_retry', entityType: 'card_refund', entityId: id });
  return submitPendingRefunds(db, { ids: [id] });
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
