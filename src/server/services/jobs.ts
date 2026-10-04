import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { invoices, jobRuns } from '@/infra/db/schema';
import { addMonths, monthOf } from '@/domain/billing/rules';
import { londonDate, londonTime } from '@/domain/time';
import { logger } from '@/infra/logger';
import { assertAuthorized, type Actor } from '../policy/authorize';
import {
  loadBusinessSettings,
  notifyOwnerDraftsReady,
  raiseRefundRequests,
  refreshMembershipDrafts,
  sendDueInvoices,
  sendPaymentReminders,
} from './billing';
import { materialiseMemberships } from './memberships';
import { reconcileOpenCheckouts, releaseExpiredCheckouts } from './payments';
import { submitPendingRefunds } from './card-refunds';

type RunOutcome = { job: string; key: string; status: 'ran' | 'skipped' | 'failed'; summary?: unknown };

/**
 * Run `fn` once per (job, key). A failed run can be retried on the next tick; a successful or
 * in-progress one is skipped. Keeps jobs idempotent however often the scheduler calls (non-negotiable 3).
 */
async function once(db: Db, job: string, key: string, fn: () => Promise<Record<string, unknown>>): Promise<RunOutcome> {
  const [claimed] = await db
    .insert(jobRuns)
    .values({ job, runKey: key })
    .onConflictDoUpdate({
      target: [jobRuns.job, jobRuns.runKey],
      set: { status: 'running', startedAt: sql`now()`, finishedAt: null },
      setWhere: eq(jobRuns.status, 'failed'),
    })
    .returning({ id: jobRuns.id });
  if (!claimed) return { job, key, status: 'skipped' };
  try {
    const summary = await fn();
    await db
      .update(jobRuns)
      .set({ status: 'succeeded', summary, finishedAt: new Date() })
      .where(eq(jobRuns.id, claimed.id));
    return { job, key, status: 'ran', summary };
  } catch (err) {
    logger.error({ job, err: err instanceof Error ? err.name : 'unknown' }, 'job failed');
    await db
      .update(jobRuns)
      .set({
        status: 'failed',
        summary: { error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' },
        finishedAt: new Date(),
      })
      .where(eq(jobRuns.id, claimed.id));
    return { job, key, status: 'failed' };
  }
}

/**
 * One scheduler tick (call every 5–15 minutes). Times are Europe/London:
 * - 01:00 daily: book membership days ahead (D47)
 * - 02:00 daily: refresh membership invoice drafts and raise any missed refund requests
 * - from the draft day (25th): email the Owner once that next month's drafts are ready
 * - every tick: send approved invoices whose send time has come (28th 09:00, D24) and
 *   payment reminders that are due (15:30 on day 4, D25)
 */
export async function runTick(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'jobs.run');
  const today = londonDate(now);
  const time = londonTime(now);
  const bs = await loadBusinessSettings(db);
  const out: RunOutcome[] = [];

  if (time >= '01:00')
    out.push(await once(db, 'membership-book-ahead', today, () => materialiseMemberships(db, actor, {}, now)));

  if (time >= '02:00')
    out.push(
      await once(db, 'invoice-drafts', today, async () => {
        const drafts = await refreshMembershipDrafts(db, actor, {}, now);
        const refunds = await raiseRefundRequests(db);
        return { ...drafts, refunds };
      }),
    );

  if (Number(today.slice(8, 10)) >= bs.draftDay && time >= '02:00') {
    const next = addMonths(monthOf(today), 1);
    out.push(
      await once(db, 'drafts-ready-email', next, async () => {
        const [row] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(invoices)
          .where(and(eq(invoices.periodMonth, next), eq(invoices.status, 'draft')));
        await notifyOwnerDraftsReady(db, next, row?.n ?? 0);
        return { drafts: row?.n ?? 0 };
      }),
    );
  }

  const sent = await sendDueInvoices(db, actor, now);
  const reminders = await sendPaymentReminders(db, actor, now);
  // Card payments (D6, D58): catch paid-but-unconfirmed checkouts, free lapsed holds, retry refunds.
  const reconciled = await reconcileOpenCheckouts(db, now);
  const holds = await releaseExpiredCheckouts(db, now);
  const refunds = await submitPendingRefunds(db);
  return {
    at: now.toISOString(),
    london: `${today} ${time}`,
    jobs: out,
    invoicesSent: sent.sent,
    remindersSent: reminders.sent,
    checkoutsPaid: reconciled.paid,
    holdsReleased: holds.released,
    refunds,
  };
}

/** Owner's "run billing now": refresh drafts and send anything due, without waiting for the schedule. */
export async function runBillingNow(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'invoices.manage');
  await materialiseMemberships(db, actor, {}, now);
  const drafts = await refreshMembershipDrafts(db, actor, {}, now);
  await raiseRefundRequests(db);
  const sent = await sendDueInvoices(db, actor, now);
  const reminders = await sendPaymentReminders(db, actor, now);
  return { drafts: drafts.drafts, sent: sent.sent, reminders: reminders.sent };
}
