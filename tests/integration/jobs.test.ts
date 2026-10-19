import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { setPaymentProvider } from '@/infra/payments';
import { SimulatedPaymentProvider } from '@/infra/payments/simulated';
import { bookingDogs, checkoutAttempts, customers, jobRuns } from '@/infra/db/schema';
import { runTick } from '@/server/services/jobs';

import { londonInstant } from '@/domain/time';
import { weekdayPicker } from '../support/dates';
import { requestAndApprove } from '../support/requests';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer } from '../support/onboard';

// Let a test make the retention job throw, to see how a failed daily job is handled.
const retention = vi.hoisted(() => ({ fail: false }));
vi.mock('@/server/services/privacy', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/services/privacy')>();
  return {
    ...real,
    runRetention: (...args: Parameters<typeof real.runRetention>) => {
      if (retention.fail) throw new TypeError('retention broke');
      return real.runRetention(...args);
    },
  };
});

/** Simulated Stripe where some checkout sessions can't be read (Stripe down, or unknown to it). */
class FlakyProvider extends SimulatedPaymentProvider {
  readonly broken = new Set<string>();
  override async getCheckout(id: string) {
    if (this.broken.has(id)) throw new Error('No such checkout.session');
    return super.getCheckout(id);
  }
}

const db = () => getDb();
const mail = new MemoryEmailProvider();
const stripe = new FlakyProvider('http://localhost:3000');
const system = { kind: 'system', job: 'test' } as const;
// Ticks are run on dates in the past so the daily jobs and sends don't touch other tests' data.
const tick = (date: string, time: string) => runTick(db(), system, londonInstant(date, time));
const alerts = () => mail.sent.filter((m) => m.to === owner.email && m.subject.includes('Scheduled job failed'));

let owner: TestUser;
let tess: TestUser;
let tessDog: string;

/** A distinct weekday at least n days ahead (two calls never return the same day, whatever today is). */
const weekdayAhead = weekdayPicker();

beforeAll(async () => {
  setEmailProvider(mail);
  setPaymentProvider(stripe);
  owner = await makeUser(db(), 'owner', 'Olive Owner');
  tess = await makeUser(db(), 'customer', 'Tess Tick');
  await readyCustomer(db(), tess);
  tessDog = await approvedDog(db(), owner, tess, 'Pepper');
});
afterAll(async () => {
  setEmailProvider(undefined);
  setPaymentProvider(undefined);
  await closeDb();
});

describe('scheduler tick resilience (M2, M6)', () => {
  afterEach(() => stripe.broken.clear());

  it('one checkout the provider can’t answer for doesn’t stop the tick, and the Owner is told once a day', async () => {
    for (const date of [weekdayAhead(33), weekdayAhead(48)])
      await requestAndApprove(db(), tess, { dogIds: [tessDog], dates: [date], session: 'full', taxi: false }, owner);
    const attempts = await db()
      .select({ a: checkoutAttempts })
      .from(checkoutAttempts)
      .innerJoin(customers, eq(customers.id, checkoutAttempts.customerId))
      .where(and(eq(customers.userId, tess.userId), eq(checkoutAttempts.status, 'open')))
      .orderBy(checkoutAttempts.createdAt)
      .then((r) => r.map((x) => x.a));
    expect(attempts).toHaveLength(2);
    const [poison, healthy] = attempts as [(typeof attempts)[0], (typeof attempts)[0]];
    stripe.broken.add(poison.providerSessionId!);
    // Both lapsed long ago, so both the reconcile and the release steps pick them up.
    await db()
      .update(checkoutAttempts)
      .set({ createdAt: new Date('2019-12-01T10:00:00Z'), expiresAt: new Date('2019-12-02T10:00:00Z') })
      .where(
        inArray(
          checkoutAttempts.id,
          attempts.map((a) => a.id),
        ),
      );
    mail.sent.length = 0;

    const r = await tick('2020-01-06', '00:30');
    expect(r.failed).toEqual(['reconcile-checkouts', 'release-checkouts']);
    expect(r.refunds).not.toBeNull(); // the steps after the failures still ran
    const [h] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, healthy.id));
    expect(h!.status).toBe('expired');
    const held = await db().select().from(bookingDogs).where(eq(bookingDogs.bookingId, healthy.bookingId!));
    expect(held.map((b) => b.status)).toEqual(['cancelled']);
    const [p] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, poison.id));
    expect(p!.status).toBe('open');
    expect(alerts().map((m) => m.subject)).toEqual([
      expect.stringContaining('reconcile-checkouts'),
      expect.stringContaining('release-checkouts'),
    ]);

    await tick('2020-01-06', '00:45'); // still broken: no second email the same day
    expect(alerts()).toHaveLength(2);

    stripe.broken.clear();
    const after = await tick('2020-01-06', '01:00');
    expect(after.failed).toEqual([]);
    const [gone] = await db().select().from(checkoutAttempts).where(eq(checkoutAttempts.id, poison.id));
    expect(gone!.status).toBe('expired');
  });

  it("takes over a run left 'running' for over 30 minutes (STALE_RUN_MINUTES), but not one still in progress", async () => {
    const day = '2020-01-07';
    const minutesAgo = (n: number) => sql`now() - make_interval(mins => ${n})`;
    await db()
      .insert(jobRuns)
      .values([
        { job: 'membership-book-ahead', runKey: day, status: 'succeeded' },
        { job: 'invoice-drafts', runKey: day, status: 'running', startedAt: minutesAgo(5) },
        { job: 'retention', runKey: day, status: 'running', startedAt: minutesAgo(31) },
      ]);
    const r = await tick(day, '03:30');
    expect(Object.fromEntries(r.jobs.map((j) => [j.job, j.status]))).toEqual({
      'membership-book-ahead': 'skipped',
      'invoice-drafts': 'skipped',
      retention: 'ran',
    });
    const [run] = await db()
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.job, 'retention'), eq(jobRuns.runKey, day)));
    expect(run!.status).toBe('succeeded');
  });

  it('emails the Owner when a daily job fails – once, however often it is retried that day', async () => {
    const day = '2020-01-08';
    await db()
      .insert(jobRuns)
      .values([
        { job: 'membership-book-ahead', runKey: day, status: 'succeeded' },
        { job: 'invoice-drafts', runKey: day, status: 'succeeded' },
      ]);
    mail.sent.length = 0;
    retention.fail = true;
    try {
      const a = await tick(day, '03:10');
      const b = await tick(day, '03:20'); // a failed run is retried on the next tick
      expect([a, b].map((t) => t.jobs.find((j) => j.job === 'retention')?.status)).toEqual(['failed', 'failed']);
    } finally {
      retention.fail = false;
    }
    expect(alerts()).toHaveLength(1);
    expect(alerts()[0]!.text).toContain('"retention" job failed (TypeError)');
    const c = await tick(day, '03:30');
    expect(c.jobs.find((j) => j.job === 'retention')?.status).toBe('ran');
  });
});
