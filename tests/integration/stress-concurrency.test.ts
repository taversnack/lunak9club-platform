/**
 * Concurrency and idempotency stress for the non-negotiables (CLAUDE.md 2 and 3): each test races several
 * callers on separate database connections and checks exact counts. Run the file repeatedly to look for
 * flakes (`for i in $(seq 20); do pnpm vitest run --project integration tests/integration/stress-concurrency.test.ts; done`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { closeDb, createDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { bookingDogs, customers, documentSequences, invoices, jobRuns } from '@/infra/db/schema';
import { setDayCapacity } from '@/server/services/owner-bookings';
import { ownerSetMembershipDays } from '@/server/services/membership-workflow';
import {
  approveInvoice,
  ownerInvoices,
  refreshMembershipDrafts,
  updateBusinessSettings,
} from '@/server/services/billing';
import { runTick } from '@/server/services/jobs';
import { ConflictError } from '@/server/errors';
import type { Actor } from '@/server/policy/authorize';
import { addMonths, monthOf } from '@/domain/billing/rules';
import { addDays, londonDate, londonInstant } from '@/domain/time';
import { weekdayPicker } from '../support/dates';
import { requestAndApprove } from '../support/requests';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, clearDayLimits, readyCustomer, releaseMemberDays } from '../support/onboard';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const today = londonDate(new Date());
const system: Actor = { kind: 'system', job: 'test' };
const weekdayAhead = weekdayPicker({ base: 20, unique: true });
const url = () => process.env.DATABASE_URL!;
let owner: TestUser;

beforeAll(async () => {
  setEmailProvider(mail);
  await clearDayLimits(db());
  owner = await makeUser(db(), 'owner', 'Olive Owner');
});
afterAll(async () => {
  await releaseMemberDays(db());
  setEmailProvider(undefined);
  await closeDb();
});

/** Separate connections, each with a small pool, so many racers do not exhaust the database's connections. */
const connections = (n: number) => Array.from({ length: n }, () => createDb(url()));
const closeAll = (cs: ReturnType<typeof connections>) => Promise.all(cs.map((c) => c.pool.end()));

describe('capacity: many simultaneous requests for a small day', () => {
  it('20 racers for 2 places: exactly 2 held, 18 waitlisted, never more places than capacity', async () => {
    const date = weekdayAhead(0);
    await setDayCapacity(db(), owner, { date, sessionCapacity: 2, taxiCapacity: 20 });
    const racers: { user: TestUser; dog: string }[] = [];
    for (let i = 0; i < 20; i++) {
      const u = await makeUser(db(), 'customer', `Stress ${i}`);
      await readyCustomer(db(), u);
      racers.push({ user: u, dog: await approvedDog(db(), owner, u, `Stress${i}`) });
    }
    const cs = connections(racers.length);
    const results = await Promise.all(
      racers.map((r, i) =>
        requestAndApprove(
          cs[i]!.db,
          r.user,
          { dogIds: [r.dog], dates: [date], session: 'full', taxi: false, ifFull: 'waitlist' },
          owner,
        ),
      ),
    );
    await closeAll(cs);
    const outcomes = results.map((r) => r.outcomes[0]!.outcome);
    expect(outcomes.filter((o) => o === 'confirmed')).toHaveLength(2);
    expect(outcomes.filter((o) => o === 'waitlisted')).toHaveLength(18);
    const rows = await db()
      .select({ status: bookingDogs.status })
      .from(bookingDogs)
      .where(
        and(
          eq(bookingDogs.serviceDate, date),
          inArray(
            bookingDogs.dogId,
            racers.map((r) => r.dog),
          ),
        ),
      );
    const holding = rows.filter((r) => ['requested', 'pending_payment', 'confirmed', 'attended'].includes(r.status));
    expect(holding).toHaveLength(2); // never above the capacity of 2
    expect(rows).toHaveLength(20); // everyone has exactly one row
  });
});

describe('invoice finalisation: two callers on the same draft', () => {
  const CUR = addMonths(monthOf(today), 1);
  const now = londonInstant(`${CUR}-26`, '10:00'); // after the draft day; this month's invoice is sent straight away
  const setupAt = londonInstant(addDays(`${CUR}-01`, -1), '09:00');
  const BUSINESS = {
    tradingName: 'Luna’s K9 Club',
    legalName: 'Luna’s K9 Club Ltd',
    companyNumber: '12345678',
    registeredOffice: '1 Test Lane\nShefford\nSG17 5AA',
    contactEmail: 'hello@lunak9club.test',
    contactPhone: '01234 567890',
    invoicePrefix: 'LK9DOUGIE-',
    paymentTermsDays: '5',
    reminderAfterDays: '4',
    reminderTime: '15:30',
    draftDay: '25',
    sendDay: '28',
    sendTime: '09:00',
  };

  it('each draft is finalised once: one number each, distinct and consecutive, one email, however many race', async () => {
    await updateBusinessSettings(db(), owner, BUSINESS);
    const customerIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const u = await makeUser(db(), 'customer', `Final ${i}`);
      await readyCustomer(db(), u);
      const dog = await approvedDog(db(), owner, u, `Final${i}`);
      await ownerSetMembershipDays(
        db(),
        owner,
        dog,
        { weekdays: [2, 4], session: 'full', startsOn: `${CUR}-01` },
        setupAt,
      );
      const [c] = await db().select({ id: customers.id }).from(customers).where(eq(customers.userId, u.userId));
      customerIds.push(c!.id);
    }
    await refreshMembershipDrafts(db(), owner, {}, now);
    const drafts = await db()
      .select()
      .from(invoices)
      .where(
        and(inArray(invoices.customerId, customerIds), eq(invoices.periodMonth, CUR), eq(invoices.status, 'draft')),
      );
    expect(drafts).toHaveLength(4);
    const [before] = await db().select().from(documentSequences).where(eq(documentSequences.key, 'invoice'));
    mail.sent.length = 0;

    // Three callers per draft, all at once, each on its own connection.
    const cs = connections(drafts.length * 3);
    const calls = drafts.flatMap((d, i) =>
      [0, 1, 2].map((k) =>
        approveInvoice(
          cs[i * 3 + k]!.db,
          owner,
          d.id,
          { version: d.version, expectedTotalPence: d.totalPence },
          now,
        ).then(
          () => 'ok' as const,
          (e: unknown) => (e instanceof ConflictError ? ('conflict' as const) : Promise.reject(e)),
        ),
      ),
    );
    const outcomes = await Promise.all(calls);
    await closeAll(cs);
    // Every caller either succeeded or was told it had already been done; none crashed.
    expect(outcomes.filter((o) => o === 'ok').length).toBeGreaterThanOrEqual(drafts.length);

    const after = await db()
      .select()
      .from(invoices)
      .where(
        inArray(
          invoices.id,
          drafts.map((d) => d.id),
        ),
      );
    const numbers = after.map((i) => i.number);
    expect(numbers.every((n) => !!n)).toBe(true);
    expect(new Set(numbers).size).toBe(drafts.length); // distinct numbers
    expect(after.every((i) => i.status === 'issued')).toBe(true);
    const [seq] = await db().select().from(documentSequences).where(eq(documentSequences.key, 'invoice'));
    expect(seq!.nextValue - before!.nextValue).toBe(drafts.length); // the sequence moved exactly once per invoice
    const nums = numbers.map((n) => Number(n!.split('-').pop())).sort((a, b) => a - b);
    expect(nums.at(-1)! - nums[0]! + 1).toBe(drafts.length); // consecutive: no gaps
    const issuedEmails = mail.sent.filter((m) => m.template === 'invoice.issued');
    expect(issuedEmails).toHaveLength(drafts.length); // one email per invoice
    expect((await ownerInvoices(db(), owner, 'all', now)).length).toBeGreaterThanOrEqual(drafts.length);
  });
});

describe('the scheduler tick running twice at once', () => {
  it('runs every once-a-day job once; the other tick skips it', async () => {
    const at = londonInstant(`${addMonths(monthOf(today), 1)}-27`, '09:05');
    const cs = connections(2);
    const [a, b] = await Promise.all([runTick(cs[0]!.db, system, at), runTick(cs[1]!.db, system, at)]);
    await closeAll(cs);
    const tally = new Map<string, string[]>();
    for (const r of [...a.jobs, ...b.jobs]) tally.set(r.job, [...(tally.get(r.job) ?? []), r.status]);
    for (const [job, statuses] of tally) {
      expect(statuses.filter((s) => s === 'ran').length, `${job} ran more than once: ${statuses}`).toBeLessThanOrEqual(
        1,
      );
      expect(statuses.includes('failed'), `${job} failed`).toBe(false);
    }
    const day = londonDate(at);
    const rows = await db()
      .select()
      .from(jobRuns)
      .where(sql`${jobRuns.runKey} like ${day + '%'}`);
    const perJob = new Map<string, number>();
    for (const r of rows) perJob.set(r.job, (perJob.get(r.job) ?? 0) + 1);
    for (const [job, n] of perJob) expect(n, `${job} has more than one run row for ${day}`).toBe(1);
  });
});
