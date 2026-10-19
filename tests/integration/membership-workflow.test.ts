import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { runTick } from '@/server/services/jobs';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import {
  accounts,
  approvalRequests,
  businessSettings,
  jobRuns,
  bookingDogs,
  customers,
  memberships,
  membershipOffers,
  users,
} from '@/infra/db/schema';
import {
  checkInvite,
  confirmMyMonth,
  confirmMyOffer,
  finishSignup,
  inviteStatus,
  monthConfirmationSummary,
  myMonthConfirmations,
  notifyUnconfirmedDays,
  ownerConfirmMonth,
  ownerCreateCustomer,
  ownerMembershipOverview,
  ownerSetMembershipDays,
  requestMyMembershipDays,
  requestMyMoveOnce,
  resendCustomerInvite,
  unconfirmedMembers,
} from '@/server/services/membership-workflow';
import { invoiceEmailExtras } from '@/server/services/membership-emails';
import { confirmByDate } from '@/domain/membership/rules';
import { approveApprovalRequest, rejectApprovalRequest } from '@/server/services/approvals';
import '@/server/services/approval-types';
const SYSTEM = { kind: 'system', job: 'test' } as const;
import { ConflictError, ValidationError } from '@/server/errors';
import { AuthorizationError } from '@/server/policy/authorize';
import { isoWeekday } from '@/domain/booking/rules';
import { addDays, londonDate } from '@/domain/time';
import { MemoryEmailProvider, linkFrom } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer, clearDayLimits, releaseMemberDays } from '../support/onboard';

const db = () => getDb();
const today = londonDate(new Date());
const mail = new MemoryEmailProvider();
let owner: TestUser;
let cust: TestUser;
let custDog: string;
let other: TestUser;

const nextWeekday = (iso: number, from = addDays(today, 1)) => {
  let d = from;
  while (isoWeekday(d) !== iso) d = addDays(d, 1);
  return d;
};
const sensitive = /password|token=|vaccin|medical|vet/i;

beforeAll(async () => {
  setEmailProvider(mail);
  await clearDayLimits(db());
  owner = await makeUser(db(), 'owner', 'Olivia Owner');
  cust = await makeUser(db(), 'customer', 'Wendy Workflow');
  other = await makeUser(db(), 'customer', 'Oscar Other');
  await readyCustomer(db(), cust);
  await readyCustomer(db(), other);
  custDog = await approvedDog(db(), owner, cust, 'Pepper');
});
afterAll(async () => {
  await releaseMemberDays(db());
  setEmailProvider(undefined);
  await closeDb();
});

describe('Owner creates a customer and the invite (D86)', () => {
  const email = `invitee.${Date.now()}@example.test`;
  let customerId: string;

  it('creates the account with an offer and emails a 7-day single-use link with the fixed cover note', async () => {
    const r = await ownerCreateCustomer(db(), owner, {
      name: 'Ivy Invitee',
      email,
      dogs: [
        {
          dogName: 'Biscuit',
          weekdays: [2, 4],
          session: 'full',
          taxi: false,
          startsOn: nextWeekday(2, addDays(today, 7)),
        },
        { dogName: 'Crumb', weekdays: [], session: 'full', taxi: false },
      ],
    });
    customerId = r.customerId;
    const offers = await db().select().from(membershipOffers).where(eq(membershipOffers.customerId, customerId));
    expect(offers.map((o) => o.dogName)).toEqual(['Biscuit']);
    const m = mail.lastTo(email)!;
    expect(m.text).toContain('Biscuit');
    expect(m.text).toMatch(/7 days/);
    const link = linkFrom(m);
    expect(link).toContain('/finish-signup?token=');
    const [u] = await db().select().from(users).where(eq(users.email, email));
    expect(u!.emailVerified).toBe(false);
    expect((await inviteStatus(db(), owner, customerId)).state).toBe('sent');
  });

  it('refuses a duplicate email and customers cannot create accounts', async () => {
    await expect(
      ownerCreateCustomer(db(), owner, { name: 'Dup', email, dogs: [{ dogName: 'X', weekdays: [] }] }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ownerCreateCustomer(db(), cust, { name: 'No', email: 'no@example.test', dogs: [{ dogName: 'X', weekdays: [] }] }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('resend replaces the earlier link; the link expires after 7 days and is single use', async () => {
    const first = new URL(linkFrom(mail.lastTo(email))).searchParams.get('token')!;
    await resendCustomerInvite(db(), owner, customerId);
    const second = new URL(linkFrom(mail.lastTo(email))).searchParams.get('token')!;
    expect(second).not.toBe(first);
    expect(await checkInvite(db(), first)).toBeNull();
    expect(await checkInvite(db(), second, new Date(Date.now() + 8 * 86_400_000))).toBeNull();
    expect((await checkInvite(db(), second))?.firstName).toBe('Ivy');

    await finishSignup(db(), { token: second, password: 'a-long-password', confirm: 'a-long-password' });
    const [u] = await db().select().from(users).where(eq(users.email, email));
    expect(u!.emailVerified).toBe(true);
    const creds = await db()
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, u!.id), eq(accounts.providerId, 'credential')));
    expect(creds).toHaveLength(1);
    await expect(
      finishSignup(db(), { token: second, password: 'a-long-password', confirm: 'a-long-password' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await inviteStatus(db(), owner, customerId)).state).toBe('signed_up');
    await expect(resendCustomerInvite(db(), owner, customerId)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('membership.days approvals (D87, D89)', () => {
  it('customer request → Owner rejects with a note: email has standard wording only', async () => {
    const start = nextWeekday(1, addDays(today, 5));
    const r = await requestMyMembershipDays(db(), cust, {
      dogId: custDog,
      weekdays: [1],
      session: 'full',
      taxi: false,
      startsOn: start,
    });
    await expect(
      requestMyMembershipDays(db(), cust, { dogId: custDog, weekdays: [3], session: 'full', startsOn: start }),
    ).rejects.toBeInstanceOf(ConflictError);
    await rejectApprovalRequest(db(), owner, r.id, { reason: 'Mondays are SECRET-NOTE busy' });
    const m = mail.lastTo(cust.email)!;
    expect(m.text).not.toContain('SECRET-NOTE');
    expect(m.html ?? '').not.toContain('SECRET-NOTE');
    expect(await db().select().from(memberships).where(eq(memberships.dogId, custDog))).toHaveLength(0);
  });

  it('approve creates the membership and books its days', async () => {
    const start = nextWeekday(1, addDays(today, 5));
    const r = await requestMyMembershipDays(db(), cust, {
      dogId: custDog,
      weekdays: [1],
      session: 'full',
      startsOn: start,
    });
    await approveApprovalRequest(db(), owner, r.id);
    const ms = await db().select().from(memberships).where(eq(memberships.dogId, custDog));
    expect(ms.some((m) => m.status === 'active' && m.weekdays.join() === '1')).toBe(true);
    const days = await db()
      .select()
      .from(bookingDogs)
      .where(and(eq(bookingDogs.dogId, custDog), eq(bookingDogs.kind, 'membership')));
    expect(days.length).toBeGreaterThan(0);
  });

  it('another customer cannot ask for days for someone else’s dog', async () => {
    await expect(
      requestMyMembershipDays(db(), other, {
        dogId: custDog,
        weekdays: [2],
        session: 'full',
        startsOn: addDays(today, 9),
      }),
    ).rejects.toThrow();
  });
});

describe('move this occasion only (membership.move_once, D90)', () => {
  it('refuses a different month and accepts a same-month swap (dates pinned, never skips)', async () => {
    // Use a Monday membership day in NEXT month and pin "now" to 5 days before that month starts,
    // so the move is always in the future, with notice, and has other weekdays in the same month.
    const month = addDays(`${today.slice(0, 7)}-28`, 7).slice(0, 7);
    const days = await db()
      .select()
      .from(bookingDogs)
      .where(
        and(eq(bookingDogs.dogId, custDog), eq(bookingDogs.kind, 'membership'), eq(bookingDogs.status, 'confirmed')),
      );
    const bd = days
      .filter((d) => d.serviceDate.startsWith(month))
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))[0];
    expect(bd, 'a booked Monday next month').toBeDefined();
    const now = new Date(`${addDays(`${month}-01`, -5)}T09:00:00Z`);
    const otherMonth = addDays(`${month}-28`, 7);
    await expect(
      requestMyMoveOnce(db(), cust, { bookingDogId: bd!.id, toDate: otherMonth }, now),
    ).rejects.toBeInstanceOf(ValidationError);
    const to = nextWeekday(2, addDays(`${month}-01`, 7)); // 2nd-ish Tuesday, same month
    expect(to.slice(0, 7)).toBe(month);
    const r = await requestMyMoveOnce(db(), cust, { bookingDogId: bd!.id, toDate: to }, now);
    await approveApprovalRequest(db(), owner, r.id, {}, now);
    const [after] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, bd!.id));
    expect(after!.serviceDate).toBe(to);
  });
});

describe('full days block approval (D90)', () => {
  it('an approval is refused when a requested day has filled up since; the request stays pending', async () => {
    const otherDog = await approvedDog(db(), owner, other, 'Juniper');
    const start = nextWeekday(5, addDays(today, 3));
    const r = await requestMyMembershipDays(db(), other, {
      dogId: otherDog,
      weekdays: [5],
      session: 'full',
      startsOn: start,
    });
    const full = addDays(start, 7);
    await db().execute(
      sql`insert into service_days (service_date, session_capacity) values (${full}, 0) on conflict (service_date) do update set session_capacity = 0`,
    );
    try {
      await expect(approveApprovalRequest(db(), owner, r.id)).rejects.toBeInstanceOf(ConflictError);
      const [req] = await db().select().from(approvalRequests).where(eq(approvalRequests.id, r.id));
      expect(req!.status).toBe('pending');
      expect(await db().select().from(memberships).where(eq(memberships.dogId, otherDog))).toHaveLength(0);
    } finally {
      await db().execute(sql`update service_days set session_capacity = null where service_date = ${full}`);
      await rejectApprovalRequest(db(), owner, r.id);
    }
  });
});

describe('confirming the Owner’s offer checks space (D87)', () => {
  it('a day that filled after the offer blocks the confirmation (never waitlisted); it works once there’s space', async () => {
    const fern = await makeUser(db(), 'customer', 'Fern Offer');
    await readyCustomer(db(), fern);
    const dog = await approvedDog(db(), owner, fern, 'Moss');
    const [c] = await db().select().from(customers).where(eq(customers.userId, fern.userId));
    const start = nextWeekday(5, addDays(today, 3));
    const [offer] = await db()
      .insert(membershipOffers)
      .values({ customerId: c!.id, dogName: 'Moss', weekdays: [5], session: 'full', startsOn: start })
      .returning();
    const full = addDays(start, 7);
    await db().execute(
      sql`insert into service_days (service_date, session_capacity) values (${full}, 0) on conflict (service_date) do update set session_capacity = 0`,
    );
    try {
      const err = await confirmMyOffer(db(), fern, { offerId: offer!.id, dogId: dog }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as Error).message).toMatch(/There’s no space on .+\. Choose other days\./);
      expect(await db().select().from(memberships).where(eq(memberships.dogId, dog))).toHaveLength(0);
      expect(await db().select().from(bookingDogs).where(eq(bookingDogs.dogId, dog))).toHaveLength(0);
      const [still] = await db().select().from(membershipOffers).where(eq(membershipOffers.id, offer!.id));
      expect(still!.closedAt).toBeNull();
    } finally {
      await db().execute(sql`update service_days set session_capacity = null where service_date = ${full}`);
    }
    await confirmMyOffer(db(), fern, { offerId: offer!.id, dogId: dog });
    const rows = await db().select().from(bookingDogs).where(eq(bookingDogs.dogId, dog));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((r) => r.status === 'waitlisted')).toHaveLength(0);
  });
});

describe('Owner changes days (D89)', () => {
  it('no approval; the customer is emailed with no sensitive data', async () => {
    const before = mail.sent.length;
    await ownerSetMembershipDays(db(), owner, custDog, { weekdays: [1, 3], session: 'full', taxi: false });
    const m = mail.sent.slice(before).find((x) => x.to === cust.email)!;
    expect(m).toBeDefined();
    expect(m.text).not.toMatch(sensitive);
    await expect(
      ownerSetMembershipDays(db(), cust, custDog, { weekdays: [1], session: 'full' }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('monthly confirmation (D88)', () => {
  it('customer and Owner confirmations are idempotent; the job keeps days', async () => {
    // Pin the clock inside the month after Pepper's membership started, so it's a confirmable month.
    const [m0] = await db()
      .select()
      .from(memberships)
      .where(and(eq(memberships.dogId, custDog), eq(memberships.status, 'active')));
    const month = addDays(`${m0!.startsOn.slice(0, 7)}-28`, 7).slice(0, 7);
    const now = new Date(`${month}-01T09:00:00Z`);
    const months = await myMonthConfirmations(db(), cust, now);
    expect(months[0]!.month).toBe(month);
    await confirmMyMonth(db(), cust, { month }, now);
    await confirmMyMonth(db(), cust, { month }, now);
    const [c] = await db().select().from(customers).where(eq(customers.userId, cust.userId));
    await ownerConfirmMonth(db(), owner, c!.id, { month }, now);
    const list = await unconfirmedMembers(db(), owner, month);
    expect(list.find((u) => u.customerId === c!.id)).toBeUndefined();
    const before = await db().select().from(bookingDogs).where(eq(bookingDogs.dogId, custDog));
    const before2 = mail.sent.length;
    const r = await notifyUnconfirmedDays(db(), SYSTEM, new Date(`${month}-02T09:00:00Z`));
    expect(typeof r.unconfirmed).toBe('number');
    for (const m of mail.sent.slice(before2)) {
      expect(m.text).not.toContain(cust.email);
      expect(m.text).not.toMatch(sensitive);
    }
    const after = await db().select().from(bookingDogs).where(eq(bookingDogs.dogId, custDog));
    expect(after.length).toBe(before.length);
    await expect(notifyUnconfirmedDays(db(), cust)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('the scheduled tick emails the Owner once per month, however often it runs', async () => {
    // Pin the clock to the 2nd of a month two months ahead (after the confirm-by day, 09:00 London),
    // and give a member unconfirmed days in that month.
    const month = addDays(addDays(`${today.slice(0, 7)}-28`, 7).slice(0, 7) + '-28', 7).slice(0, 7);
    const dog = await approvedDog(db(), owner, other, 'Hazel');
    await ownerSetMembershipDays(db(), owner, dog, {
      weekdays: [1, 2, 3, 4, 5],
      session: 'full',
      startsOn: addDays(today, 1),
    });
    const now = new Date(`${month}-02T08:30:00Z`);
    const subject = /membership confirmations for/;
    const ownerMails = () => mail.sent.filter((m) => m.to === owner.email && subject.test(m.subject)).length;
    const before = ownerMails();
    const unconfirmed = (await unconfirmedMembers(db(), owner, month)).length;
    await runTick(db(), SYSTEM, now);
    await runTick(db(), SYSTEM, new Date(now.getTime() + 3_600_000));
    await runTick(db(), SYSTEM, new Date(now.getTime() + 86_400_000));
    expect(ownerMails() - before).toBe(unconfirmed ? 1 : 0);
    expect(unconfirmed).toBeGreaterThan(0);
    // The club name appears once in the subject (the template adds it).
    for (const m of mail.sent.filter((x) => x.to === owner.email && subject.test(x.subject)))
      expect(m.subject).toMatch(/^Luna’s K9 Club: membership confirmations for \w+ \d{4} – /);
    const runs = await db()
      .select()
      .from(jobRuns)
      .where(and(eq(jobRuns.job, 'membership-unconfirmed'), eq(jobRuns.runKey, month)));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('succeeded');
  });
});

describe('monthly confirmation decisions (D92–D94)', () => {
  // Next month: dogs with days from tomorrow are in place on its 1st; a dog starting after the 1st joins partway.
  const month = addDays(`${today.slice(0, 7)}-28`, 7).slice(0, 7);
  const first = `${month}-01`;
  const tag = Date.now().toString(36);
  let by: string;
  let onTime: Date;
  let late: Date;
  let jobAt: Date;
  const people: Record<'alma' | 'bert' | 'cara' | 'dina', { user: TestUser; customerId: string; name: string }> =
    {} as never;

  beforeAll(async () => {
    const [bs] = await db().select().from(businessSettings).where(eq(businessSettings.id, 1));
    by = confirmByDate(month, bs!.confirmByDay);
    onTime = new Date(`${by}T09:00:00Z`);
    late = new Date(`${addDays(by, 1)}T07:00:00Z`);
    jobAt = new Date(`${addDays(by, 1)}T09:30:00Z`);
    const make = async (key: keyof typeof people, first: string) => {
      const name = `${first} ${tag}`;
      const user = await makeUser(db(), 'customer', name);
      await readyCustomer(db(), user);
      const [c] = await db().select().from(customers).where(eq(customers.userId, user.userId));
      people[key] = { user, customerId: c!.id, name };
      return user;
    };
    const inPlace = { weekdays: [2], session: 'full', startsOn: addDays(today, 1) };
    const alma = await make('alma', 'Alma');
    await ownerSetMembershipDays(db(), owner, await approvedDog(db(), owner, alma, 'Rolo'), inPlace);
    const bert = await make('bert', 'Bert');
    await ownerSetMembershipDays(db(), owner, await approvedDog(db(), owner, bert, 'Tess'), inPlace);
    const cara = await make('cara', 'Cara');
    await ownerSetMembershipDays(db(), owner, await approvedDog(db(), owner, cara, 'Ziggy'), inPlace);
    await ownerSetMembershipDays(db(), owner, await approvedDog(db(), owner, cara, 'Nala'), inPlace);
    const dina = await make('dina', 'Dina');
    await ownerSetMembershipDays(db(), owner, await approvedDog(db(), owner, dina, 'Juno'), {
      weekdays: [1, 2, 3, 4, 5],
      session: 'full',
      startsOn: nextWeekday(3, addDays(first, 1)),
    });
  });

  it('a mid-month joiner gets no confirmation for that month: not in the portal, not confirmable, no invoice section (D93)', async () => {
    const { user, customerId } = people.dina;
    expect((await myMonthConfirmations(db(), user, onTime)).find((m) => m.month === month)).toBeUndefined();
    await expect(confirmMyMonth(db(), user, { month }, onTime)).rejects.toThrow(/covered by the joining invoice/);
    await expect(ownerConfirmMonth(db(), owner, customerId, { month }, onTime)).rejects.toBeInstanceOf(ConflictError);
    const extras = await invoiceEmailExtras(db(), { kind: 'membership', periodMonth: month, customerId });
    expect(extras.confirm).toBeUndefined();
    expect(extras.faqs?.length).toBeGreaterThan(0);
    const member = await invoiceEmailExtras(db(), {
      kind: 'membership',
      periodMonth: month,
      customerId: people.alma.customerId,
    });
    expect(member.confirm?.url).toContain(`confirm=${month}`);
    expect((await unconfirmedMembers(db(), owner, month)).find((u) => u.customerId === customerId)).toBeUndefined();
  });

  it('a confirmation after the confirm-by day is accepted but marked late, in both portals (D94)', async () => {
    await confirmMyMonth(db(), people.alma.user, { month }, onTime);
    await confirmMyMonth(db(), people.bert.user, { month }, late);
    const bertSees = (await myMonthConfirmations(db(), people.bert.user, late)).find((m) => m.month === month)!;
    expect(bertSees.confirmedAt).not.toBeNull();
    expect(bertSees.late).toBe(true);
    const almaSees = (await myMonthConfirmations(db(), people.alma.user, late)).find((m) => m.month === month)!;
    expect(almaSees.late).toBe(false);
    const ownerSees = await ownerMembershipOverview(db(), owner, people.bert.customerId, late);
    expect(ownerSees.months.find((m) => m.month === month)).toMatchObject({ late: true, byOwner: false });
    // Confirming again later doesn't change an on-time confirmation.
    await confirmMyMonth(db(), people.alma.user, { month }, late);
    const again = (await myMonthConfirmations(db(), people.alma.user, late)).find((m) => m.month === month)!;
    expect(again.late).toBe(false);
  });

  it('the Owner summary lists who has confirmed (on time or late) and who hasn’t, by customer and dog (D92, D33)', async () => {
    const summary = await monthConfirmationSummary(db(), owner, month);
    const find = (k: keyof typeof people) => summary.find((r) => r.customerId === people[k].customerId);
    expect(find('alma')).toMatchObject({ status: 'confirmed', dogs: ['Rolo'] });
    expect(find('bert')).toMatchObject({ status: 'late', dogs: ['Tess'] });
    expect(find('cara')).toMatchObject({ status: 'unconfirmed', dogs: ['Nala', 'Ziggy'] });
    expect(find('dina')).toBeUndefined();

    const before = mail.sent.length;
    const r = await notifyUnconfirmedDays(db(), SYSTEM, jobAt);
    expect(r.unconfirmed).toBeGreaterThanOrEqual(1);
    expect(r.late).toBeGreaterThanOrEqual(1);
    expect(r.confirmed).toBeGreaterThanOrEqual(1);
    const m = mail.sent.slice(before).find((x) => x.to === owner.email)!;
    expect(m.subject).toMatch(
      new RegExp(`^Luna’s K9 Club: membership confirmations for \\w+ \\d{4} – \\d+ not confirmed$`),
    );
    const i = (t: string) => m.text.indexOf(t);
    const cara = `- ${people.cara.name}: Nala, Ziggy`;
    const bert = `- ${people.bert.name}: Tess`;
    const alma = `- ${people.alma.name}: Rolo`;
    for (const line of [cara, bert, alma]) expect(i(line)).toBeGreaterThan(-1);
    expect(i('Not confirmed')).toBeLessThan(i(cara));
    expect(i(cara)).toBeLessThan(i('Confirmed late'));
    expect(i('Confirmed late')).toBeLessThan(i(bert));
    expect(i(bert)).toBeLessThan(i('\nConfirmed ('));
    expect(i('\nConfirmed (')).toBeLessThan(i(alma));
    expect(m.text).not.toContain(people.dina.name);
    expect(m.text).not.toContain('Juno');
    for (const p of Object.values(people)) expect(m.text).not.toContain(p.user.email);
    expect(m.text).not.toMatch(sensitive);
    expect(m.html).toContain(people.cara.name);

    // The Owner confirming for Cara after the deadline is late too.
    await ownerConfirmMonth(db(), owner, people.cara.customerId, { month }, late);
    expect(
      (await monthConfirmationSummary(db(), owner, month)).find((x) => x.customerId === people.cara.customerId),
    ).toMatchObject({ status: 'late', byOwner: true });
  });
});
