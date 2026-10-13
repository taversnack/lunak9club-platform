import 'server-only';
export { tickFailed } from './tick-result';
import { and, eq, lt, or, sql } from 'drizzle-orm';
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
import { sendBookingReminders, sendVaccinationReminders } from './reminders';
import { expireBookingRequests } from './booking-requests';
import { runRetention } from './privacy';
import { getStorage } from '@/infra/storage';
import { ownerBillingMessage } from '@/infra/email/templates';
import { appUrl, ownerEmails, sendSafely } from '../notify';
import { claimNotification } from './reminders';

type RunOutcome = { job: string; key: string; status: 'ran' | 'skipped' | 'failed'; summary?: unknown };

/**
 * A run still 'running' after this long was cut off (function timeout, deploy, crash) and is taken
 * over by the next tick. Every job finishes in seconds; this is well past any host's time limit.
 */
export const STALE_RUN_MINUTES = 30;

/** Email the Owner that a scheduled job failed – once per job per day, however often it retries. */
async function alertOwner(db: Db, job: string, what: string, now: Date) {
  try {
    if (!(await claimNotification(db, `job-failed:${job}:${londonDate(now)}`, 'job-failed'))) return;
    for (const to of await ownerEmails(db))
      await sendSafely(
        ownerBillingMessage(
          to,
          `Scheduled job failed: ${job}`,
          `The scheduled "${job}" job failed (${what}). It will be tried again automatically on the next run. If this email comes again tomorrow, the problem hasn't cleared – please check the server logs.`,
          appUrl('/admin'),
        ),
      );
  } catch (err) {
    logger.error({ job, err: err instanceof Error ? err.name : 'unknown' }, 'job failure alert failed');
  }
}

/**
 * Run `fn` once per (job, key). A failed run, or one stuck 'running' for STALE_RUN_MINUTES, is retried
 * on the next tick; a successful or in-progress one is skipped. Keeps jobs idempotent however often
 * the scheduler calls (non-negotiable 3).
 */
async function once(
  db: Db,
  job: string,
  key: string,
  fn: () => Promise<Record<string, unknown>>,
  now: Date,
): Promise<RunOutcome> {
  const [claimed] = await db
    .insert(jobRuns)
    .values({ job, runKey: key })
    .onConflictDoUpdate({
      target: [jobRuns.job, jobRuns.runKey],
      set: { status: 'running', startedAt: sql`now()`, finishedAt: null },
      setWhere: or(
        eq(jobRuns.status, 'failed'),
        and(
          eq(jobRuns.status, 'running'),
          lt(jobRuns.startedAt, sql`now() - make_interval(mins => ${STALE_RUN_MINUTES})`),
        ),
      ),
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
    await alertOwner(db, job, err instanceof Error ? err.name : 'unknown error', now);
    return { job, key, status: 'failed' };
  }
}

/**
 * Run one every-tick step so that its failure doesn't stop the steps after it. Steps that carry on
 * past failing items report them as `errors`; either way the Owner is told (once a day).
 */
async function step<T extends object>(
  db: Db,
  job: string,
  now: Date,
  failed: string[],
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await fn();
    const errors = (result as { errors?: unknown }).errors;
    if (typeof errors === 'number' && errors > 0) {
      failed.push(job);
      await alertOwner(db, job, `${errors} item${errors === 1 ? '' : 's'} could not be processed`, now);
    }
    return result;
  } catch (err) {
    logger.error({ job, err: err instanceof Error ? err.name : 'unknown' }, 'tick step failed');
    failed.push(job);
    await alertOwner(db, job, err instanceof Error ? err.name : 'unknown error', now);
    return null;
  }
}

/**
 * One scheduler tick (call every 5–15 minutes). Times are Europe/London:
 * - 01:00 daily: book membership days ahead (D47)
 * - 02:00 daily: refresh membership invoice drafts and raise any missed refund requests
 * - from the draft day (25th): email the Owner once that next month's drafts are ready
 * - 03:00 daily: retention schedule (D64)
 * - 08:00 daily: vaccination reminders (D66); 17:00 daily: tomorrow's booking reminders (D67)
 * - every tick: close booking requests whose cut-off (23:59 the day before) has passed (D79)
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
    out.push(await once(db, 'membership-book-ahead', today, () => materialiseMemberships(db, actor, {}, now), now));

  if (time >= '02:00')
    out.push(
      await once(
        db,
        'invoice-drafts',
        today,
        async () => {
          const drafts = await refreshMembershipDrafts(db, actor, {}, now);
          const refunds = await raiseRefundRequests(db);
          return { ...drafts, refunds };
        },
        now,
      ),
    );

  if (Number(today.slice(8, 10)) >= bs.draftDay && time >= '02:00') {
    const next = addMonths(monthOf(today), 1);
    out.push(
      await once(
        db,
        'drafts-ready-email',
        next,
        async () => {
          const [row] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(invoices)
            .where(and(eq(invoices.periodMonth, next), eq(invoices.status, 'draft')));
          await notifyOwnerDraftsReady(db, next, row?.n ?? 0);
          return { drafts: row?.n ?? 0 };
        },
        now,
      ),
    );
  }

  // Compliance and welfare (Phase 7): reminders and the retention schedule.
  if (time >= '03:00')
    out.push(await once(db, 'retention', today, () => runRetention(db, getStorage(), actor, now), now));
  if (time >= '08:00')
    out.push(await once(db, 'vaccination-reminders', today, () => sendVaccinationReminders(db, actor, now), now));
  if (time >= '17:00')
    out.push(await once(db, 'booking-reminders', today, () => sendBookingReminders(db, actor, now), now));
  // Every-tick steps: each runs even if an earlier one fails (M2).
  const failed: string[] = [];
  const requests = await step(db, 'expire-requests', now, failed, () => expireBookingRequests(db, actor, now));
  const sent = await step(db, 'send-invoices', now, failed, () => sendDueInvoices(db, actor, now));
  const reminders = await step(db, 'payment-reminders', now, failed, () => sendPaymentReminders(db, actor, now));
  // Card payments (D6, D58): catch paid-but-unconfirmed checkouts, free lapsed holds, retry refunds.
  const reconciled = await step(db, 'reconcile-checkouts', now, failed, () => reconcileOpenCheckouts(db, now));
  const holds = await step(db, 'release-checkouts', now, failed, () => releaseExpiredCheckouts(db, now));
  const refunds = await step(db, 'card-refunds', now, failed, () => submitPendingRefunds(db));
  return {
    at: now.toISOString(),
    london: `${today} ${time}`,
    jobs: out,
    invoicesSent: sent?.sent ?? null,
    remindersSent: reminders?.sent ?? null,
    checkoutsPaid: reconciled?.paid ?? null,
    holdsReleased: holds?.released ?? null,
    refunds,
    requestsExpired: requests?.expired ?? null,
    requestDaysClosed: requests?.daysClosed ?? null,
    failed,
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
