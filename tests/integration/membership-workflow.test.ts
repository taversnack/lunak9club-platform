import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { accounts, bookingDogs, customers, memberships, membershipOffers, users } from '@/infra/db/schema';
import {
  checkInvite,
  confirmMyMonth,
  finishSignup,
  inviteStatus,
  myMonthConfirmations,
  notifyUnconfirmedDays,
  ownerConfirmMonth,
  ownerCreateCustomer,
  ownerSetMembershipDays,
  requestMyMembershipDays,
  requestMyMoveOnce,
  resendCustomerInvite,
  unconfirmedMembers,
} from '@/server/services/membership-workflow';
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
  it('refuses a different month and accepts a same-month swap', async () => {
    const days = await db()
      .select()
      .from(bookingDogs)
      .where(
        and(eq(bookingDogs.dogId, custDog), eq(bookingDogs.kind, 'membership'), eq(bookingDogs.status, 'confirmed')),
      );
    const bd = days
      .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))
      .find((d) => d.serviceDate > addDays(today, 3));
    if (!bd) return;
    const nextMonth = addDays(`${bd.serviceDate.slice(0, 7)}-01`, 40);
    await expect(requestMyMoveOnce(db(), cust, { bookingDogId: bd.id, toDate: nextMonth })).rejects.toBeInstanceOf(
      ValidationError,
    );
    let to = addDays(bd.serviceDate, 1);
    while (isoWeekday(to) > 5) to = addDays(to, 1);
    if (to.slice(0, 7) !== bd.serviceDate.slice(0, 7)) return;
    const r = await requestMyMoveOnce(db(), cust, { bookingDogId: bd.id, toDate: to });
    await approveApprovalRequest(db(), owner, r.id);
    const [after] = await db().select().from(bookingDogs).where(eq(bookingDogs.id, bd.id));
    expect(after!.serviceDate).toBe(to);
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
  it('customer and Owner confirmations are idempotent; the job keeps days and only counts', async () => {
    const months = await myMonthConfirmations(db(), cust);
    const month = months[0]!.month;
    await confirmMyMonth(db(), cust, { month });
    await confirmMyMonth(db(), cust, { month });
    const [c] = await db().select().from(customers).where(eq(customers.userId, cust.userId));
    await ownerConfirmMonth(db(), owner, c!.id, { month });
    const list = await unconfirmedMembers(db(), owner, month);
    expect(list.find((u) => u.customerId === c!.id)).toBeUndefined();
    const before = await db().select().from(bookingDogs).where(eq(bookingDogs.dogId, custDog));
    const before2 = mail.sent.length;
    const r = await notifyUnconfirmedDays(db(), SYSTEM);
    expect(typeof r.unconfirmed).toBe('number');
    for (const m of mail.sent.slice(before2)) expect(m.text).not.toContain('Wendy');
    const after = await db().select().from(bookingDogs).where(eq(bookingDogs.dogId, custDog));
    expect(after.length).toBe(before.length);
    await expect(notifyUnconfirmedDays(db(), cust)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
