import { subjectKey } from '@/domain/approvals/rules';
import 'server-only';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import {
  accounts,
  bookingDogs,
  businessSettings,
  customerInvites,
  customers,
  dogs,
  membershipMonthConfirmations,
  membershipOffers,
  userRoles,
  users,
} from '@/infra/db/schema';
import { formatMonth, monthOf, type Month } from '@/domain/billing/rules';
import { type Session } from '@/domain/booking/rules';
import { confirmByDate, isLateConfirmation, validWeekdays } from '@/domain/membership/rules';
import { addDays, formatUkDate, londonDate, type IsoDate } from '@/domain/time';
import {
  customerInviteMessage,
  membershipDaysChangedMessage,
  ownerConfirmationSummaryMessage,
} from '@/infra/email/templates';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { appUrl, firstNameOf, ownerEmails, sendSafely } from '../notify';
import { checkbox, idOrNotFound, isoDate, parseInput, requiredText } from '../validation';
import { asUser, getMyCustomer } from './customers';
import { createApprovalRequest } from './approvals';
import { loadSettings } from './booking-shared';
import { refreshMembershipDrafts } from './billing';
import { materialiseMemberships } from './memberships';
import { currentFaqs } from './membership-emails';
import { dogsToConfirm } from './membership-confirmations';
import { checkMoveOnce, type MembershipDaysPayload, type MoveOncePayload } from './membership-approvals';
import {
  changeStartFor,
  currentMembership,
  describePlan,
  fullDatesFor,
  fullDatesMessage,
  setMembershipDaysTx,
  type DaysPlan,
} from './membership-days';

/**
 * Membership workflow (D86–D90): the Owner creates a customer's account with each dog's agreed
 * days, the customer finishes signing up from a 7-day single-use invite, confirms or changes the
 * days, confirms each month's days, and moves days through approval requests. Emails carry names,
 * dog names, weekdays and dates only (D33).
 */

const INVITE_DAYS = 7;
const SYSTEM = { kind: 'system', job: 'membership-workflow' } as const;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const weekdaysField = z.preprocess(
  (v) => (Array.isArray(v) ? v : v === undefined || v === '' ? [] : [v]),
  z.array(z.coerce.number().int()),
);
const sessionField = z.literal('full', { message: 'We only offer full days' });

// ---- Owner creates the account (D86) ---------------------------------------------------------

export const OwnerDogInput = z.object({
  dogName: requiredText('the dog’s name', 60),
  weekdays: weekdaysField,
  session: sessionField.default('full'),
  taxi: checkbox,
  startsOn: z.string().trim().optional(),
});

export const OwnerCreateCustomerInput = z.object({
  name: requiredText('the customer’s name', 120),
  email: z.string().trim().toLowerCase().email('Enter a real email address').max(200),
  dogs: z.array(OwnerDogInput).min(1, 'Add at least one dog').max(6),
});

type OfferPlan = DaysPlan & { dogName: string; startsOn: IsoDate };

/** Checks each dog's days: blank is fine (the customer chooses); otherwise valid days, a start and space. */
async function checkOfferPlans(
  db: Db,
  rows: z.infer<typeof OwnerDogInput>[],
  now: Date,
): Promise<{ plans: (OfferPlan | null)[]; fields: Record<string, string> }> {
  const settings = await loadSettings(db);
  const today = londonDate(now);
  const fields: Record<string, string> = {};
  const plans: (OfferPlan | null)[] = [];
  for (const [i, r] of rows.entries()) {
    if (!r.weekdays.length) {
      plans.push(null);
      continue;
    }
    const wd = validWeekdays(r.weekdays, settings.openWeekdays);
    if (wd) fields[`dogs.${i}.weekdays`] = wd;
    const startsOn = r.startsOn ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) fields[`dogs.${i}.startsOn`] = 'Enter the first day as a real date';
    else if (startsOn <= today) fields[`dogs.${i}.startsOn`] = 'Choose tomorrow or later';
    else if (startsOn > addDays(today, settings.maxAdvanceDays))
      fields[`dogs.${i}.startsOn`] = `Choose a date within ${settings.maxAdvanceDays} days`;
    plans.push(
      wd || fields[`dogs.${i}.startsOn`]
        ? null
        : {
            dogName: r.dogName,
            weekdays: [...new Set(r.weekdays)].sort(),
            session: r.session as Session,
            taxi: r.taxi,
            startsOn,
          },
    );
  }
  // Space (approved plan): only offer days that have space in the book-ahead window.
  for (const [i, p] of plans.entries()) {
    if (!p) continue;
    const full = await db.transaction((tx) => fullDatesFor(tx, randomUUID(), p, p.startsOn, now));
    if (full.length) fields[`dogs.${i}.weekdays`] = fullDatesMessage(full);
  }
  return { plans, fields };
}

async function newInviteTx(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  userId: string,
  by: string | null,
  now: Date,
) {
  // Resending ends any earlier unused invite.
  await tx
    .update(customerInvites)
    .set({ expiresAt: now })
    .where(and(eq(customerInvites.userId, userId), isNull(customerInvites.usedAt)));
  const token = randomBytes(32).toString('base64url');
  await tx.insert(customerInvites).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000),
    createdBy: by,
  });
  return token;
}

async function sendInvite(db: Db, customerId: string, token: string, ownerName: string) {
  const [who] = await db
    .select({ email: users.email, name: users.name })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, customerId));
  if (!who) return;
  const offers = await db
    .select()
    .from(membershipOffers)
    .where(and(eq(membershipOffers.customerId, customerId), isNull(membershipOffers.closedAt)))
    .orderBy(asc(membershipOffers.createdAt));
  const days = offers.map(
    (o) =>
      `${o.dogName}: ${describePlan({ weekdays: o.weekdays, session: o.session as Session, taxi: o.taxi }, o.startsOn)}`,
  );
  await sendSafely(
    customerInviteMessage(
      who.email,
      firstNameOf(who.name),
      firstNameOf(ownerName),
      days.length ? days : null,
      appUrl(`/finish-signup?token=${encodeURIComponent(token)}`),
      await currentFaqs(db),
    ),
  );
}

async function ownerName(db: Db, actor: Actor) {
  if (actor.kind !== 'user') return 'Luna’s K9 Club';
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.userId));
  return u?.name ?? 'Luna’s K9 Club';
}

/** Owner creates a customer account with each dog's agreed days (or blank) and sends the invite (D86, D87). */
export async function ownerCreateCustomer(db: Db, actor: Actor, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'users.manage');
  assertAuthorized(actor, 'memberships.manage');
  const d = parseInput(OwnerCreateCustomerInput, input);
  const { plans, fields } = await checkOfferPlans(db, d.dogs, now);
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, d.email));
  if (taken) fields.email = 'There’s already an account with this email address';
  if (Object.keys(fields).length) throw new ValidationError('Please check the highlighted fields.', fields);

  const by = actor.kind === 'user' ? actor.userId : null;
  const { customerId, token } = await db.transaction(async (tx) => {
    const userId = randomUUID();
    await tx.insert(users).values({ id: userId, email: d.email, name: d.name, emailVerified: false });
    await tx.insert(userRoles).values({ userId, roleKey: 'customer', grantedBy: by }).onConflictDoNothing();
    const [c] = await tx.insert(customers).values({ userId }).returning({ id: customers.id });
    const offerRows = d.dogs.map((dog, i) => ({ dog, plan: plans[i] })).filter((x) => x.plan);
    if (offerRows.length)
      await tx.insert(membershipOffers).values(
        offerRows.map(({ plan }) => ({
          customerId: c!.id,
          dogName: plan!.dogName,
          weekdays: plan!.weekdays,
          session: plan!.session,
          taxi: plan!.taxi,
          startsOn: plan!.startsOn,
          createdBy: by,
        })),
      );
    const token = await newInviteTx(tx, userId, by, now);
    await recordAudit(tx, {
      actor,
      action: 'customer.created_by_owner',
      entityType: 'customer',
      entityId: c!.id,
      metadata: { dogs: d.dogs.length, offers: offerRows.length },
    });
    return { customerId: c!.id, token };
  });
  await sendInvite(db, customerId, token, await ownerName(db, actor));
  return { customerId };
}

/** Owner resends the invite: a new 7-day link; any earlier unused one stops working. */
export async function resendCustomerInvite(db: Db, actor: Actor, rawCustomerId: string, now = new Date()) {
  assertAuthorized(actor, 'users.manage');
  const id = idOrNotFound(rawCustomerId, 'Customer');
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c) throw new NotFoundError('Customer');
  const [hasPassword] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, c.userId), eq(accounts.providerId, 'credential')));
  if (hasPassword) throw new ConflictError('This customer has already finished signing up.');
  const by = actor.kind === 'user' ? actor.userId : null;
  const token = await db.transaction(async (tx) => {
    const t = await newInviteTx(tx, c.userId, by, now);
    await recordAudit(tx, { actor, action: 'customer.invite_resent', entityType: 'customer', entityId: c.id });
    return t;
  });
  await sendInvite(db, c.id, token, await ownerName(db, actor));
}

/** Owner's view of the invite for the customer page. */
export async function inviteStatus(db: Db, actor: Actor, rawCustomerId: string, now = new Date()) {
  assertAuthorized(actor, 'customers.read');
  const [c] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, idOrNotFound(rawCustomerId, 'Customer')));
  if (!c) throw new NotFoundError('Customer');
  const [hasPassword] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, c.userId), eq(accounts.providerId, 'credential')));
  if (hasPassword) return { state: 'signed_up' as const };
  const [latest] = await db
    .select()
    .from(customerInvites)
    .where(eq(customerInvites.userId, c.userId))
    .orderBy(sql`${customerInvites.createdAt} desc`)
    .limit(1);
  if (!latest) return { state: 'none' as const };
  return latest.expiresAt > now
    ? { state: 'sent' as const, expiresAt: latest.expiresAt }
    : { state: 'expired' as const, expiresAt: latest.expiresAt };
}

// ---- Customer finishes signing up --------------------------------------------------------------

const FinishSignupInput = z
  .object({
    token: z.string().min(10).max(200),
    password: z.string().min(10, 'Use at least 10 characters').max(128, 'Use 128 characters or fewer'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'The passwords don’t match', path: ['confirm'] });

const INVALID_LINK = 'This link has expired or has already been used. Ask Luna’s K9 Club to send a new one.';

/** Is this invite link still usable? (For the finish-signup page; reveals nothing but a first name.) */
export async function checkInvite(db: Db, token: string, now = new Date()) {
  const [row] = await db
    .select({ inv: customerInvites, name: users.name, email: users.email })
    .from(customerInvites)
    .innerJoin(users, eq(users.id, customerInvites.userId))
    .where(eq(customerInvites.tokenHash, hashToken(token)));
  if (!row || row.inv.usedAt || row.inv.expiresAt <= now) return null;
  return { firstName: firstNameOf(row.name), email: row.email };
}

/**
 * The customer chooses a password from the invite link: the link is used up, the email counts as
 * confirmed (they received the link), and they can then sign in (D86). Single use, 7 days.
 */
export async function finishSignup(db: Db, input: unknown, now = new Date()) {
  const d = parseInput(FinishSignupInput, input);
  const hash = await hashPassword(d.password);
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(customerInvites)
      .where(eq(customerInvites.tokenHash, hashToken(d.token)))
      .for('update');
    if (!inv || inv.usedAt || inv.expiresAt <= now) throw new ConflictError(INVALID_LINK);
    const [existing] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, inv.userId), eq(accounts.providerId, 'credential')));
    if (existing) throw new ConflictError(INVALID_LINK);
    await tx.update(customerInvites).set({ usedAt: now }).where(eq(customerInvites.id, inv.id));
    await tx.insert(accounts).values({
      id: randomUUID(),
      accountId: inv.userId,
      providerId: 'credential',
      userId: inv.userId,
      password: hash,
    });
    await tx.update(users).set({ emailVerified: true }).where(eq(users.id, inv.userId));
    await recordAudit(tx, { actor: SYSTEM, action: 'auth.invite_accepted', entityType: 'user', entityId: inv.userId });
    const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, inv.userId));
    return { email: u!.email };
  });
}

// ---- Customer: offers and days (D87, D89) -------------------------------------------------------

/** The customer's open offers, dogs and memberships for the membership page. */
export async function myMembershipDays(db: Db, actor: Actor, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'memberships.self.manage', { ownerUserId: customer.userId });
  const today = londonDate(now);
  const [offers, myDogs] = await Promise.all([
    db
      .select()
      .from(membershipOffers)
      .where(and(eq(membershipOffers.customerId, customer.id), isNull(membershipOffers.closedAt)))
      .orderBy(asc(membershipOffers.createdAt)),
    db
      .select({ id: dogs.id, name: dogs.name })
      .from(dogs)
      .where(and(eq(dogs.customerId, customer.id), isNull(dogs.archivedAt)))
      .orderBy(asc(dogs.name)),
  ]);
  const withDays = await Promise.all(
    myDogs.map(async (dg) => ({ ...dg, membership: await currentMembership(db, dg.id, today) })),
  );
  return {
    offers,
    dogs: withDays,
    changeFrom: await changeStartFor(db, customer.id, now),
    customerId: customer.id,
  };
}

async function loadMyDog(db: Db, customerId: string, rawDogId: string) {
  const [dog] = await db
    .select()
    .from(dogs)
    .where(and(eq(dogs.id, idOrNotFound(rawDogId, 'Dog')), eq(dogs.customerId, customerId), isNull(dogs.archivedAt)));
  if (!dog) throw new NotFoundError('Dog');
  return dog;
}

const ConfirmOfferInput = z.object({ offerId: z.string(), dogId: z.string() });

/** The customer confirms the Owner's days unchanged for one of their dogs: the membership starts, no approval (D87). */
export async function confirmMyOffer(db: Db, actor: Actor, input: unknown, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'memberships.self.manage', { ownerUserId: customer.userId });
  const d = parseInput(ConfirmOfferInput, input);
  const dog = await loadMyDog(db, customer.id, d.dogId);
  const today = londonDate(now);
  if (await currentMembership(db, dog.id, today))
    throw new ConflictError(`${dog.name} already has membership days. Ask to change them instead.`);
  const id = await db.transaction(async (tx) => {
    const [offer] = await tx
      .select()
      .from(membershipOffers)
      .where(
        and(
          eq(membershipOffers.id, idOrNotFound(d.offerId, 'Offer')),
          eq(membershipOffers.customerId, customer.id),
          isNull(membershipOffers.closedAt),
        ),
      )
      .for('update');
    if (!offer) throw new NotFoundError('Offer');
    const startsOn = offer.startsOn > today ? offer.startsOn : addDays(today, 1);
    // A day may have filled since the Owner's offer: block, as a request would be (never waitlist).
    const plan: DaysPlan = { weekdays: offer.weekdays, session: offer.session as Session, taxi: offer.taxi };
    const full = await fullDatesFor(tx, dog.id, plan, startsOn, now);
    if (full.length) throw new ConflictError(fullDatesMessage(full));
    const r = await setMembershipDaysTx(tx, me, {
      weekdays: offer.weekdays,
      session: offer.session as Session,
      taxi: offer.taxi,
      customerId: customer.id,
      dogId: dog.id,
      startsOn,
      requestedBy: me.userId,
      now,
      source: 'offer',
    });
    await tx
      .update(membershipOffers)
      .set({ closedAt: now, confirmedAt: now, dogId: dog.id })
      .where(eq(membershipOffers.id, offer.id));
    return r.id;
  });
  await materialiseMemberships(db, SYSTEM, { membershipId: id }, now);
  await refreshMembershipDrafts(db, SYSTEM, { customerId: customer.id }, now);
  return { membershipId: id };
}

export const RequestDaysInput = z.object({
  dogId: z.string(),
  weekdays: weekdaysField,
  session: sessionField,
  taxi: checkbox,
  /** New memberships only; a change starts from the next month that hasn't been invoiced (D89). */
  startsOn: z.string().trim().optional(),
  offerId: z.string().optional(),
});

/** The customer chooses or changes a dog's regular days; the Owner approves (membership.days, D87, D89). */
export async function requestMyMembershipDays(db: Db, actor: Actor, input: unknown, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'memberships.self.manage', { ownerUserId: customer.userId });
  const d = parseInput(RequestDaysInput, input);
  const settings = await loadSettings(db);
  const today = londonDate(now);
  const fields: Record<string, string> = {};
  const wd = validWeekdays(d.weekdays, settings.openWeekdays);
  if (wd) fields.weekdays = wd;
  const dog = await loadMyDog(db, customer.id, d.dogId);
  const current = await currentMembership(db, dog.id, today);
  let startsOn: IsoDate;
  if (current) startsOn = await changeStartFor(db, customer.id, now);
  else {
    startsOn = d.startsOn ?? '';
    const check = isoDate('the first day').safeParse(startsOn);
    if (!check.success) fields.startsOn = 'Enter the first day as a real date';
    else if (startsOn <= today) fields.startsOn = 'Choose tomorrow or later';
    else if (startsOn > addDays(today, settings.maxAdvanceDays))
      fields.startsOn = `Choose a date within ${settings.maxAdvanceDays} days`;
  }
  if (Object.keys(fields).length) throw new ValidationError('Please check the highlighted fields.', fields);
  const plan: DaysPlan = { weekdays: [...new Set(d.weekdays)].sort(), session: d.session as Session, taxi: d.taxi };
  if (
    current &&
    current.session === plan.session &&
    current.taxi === plan.taxi &&
    current.weekdays.join() === plan.weekdays.join()
  )
    throw new ValidationError('Please check the highlighted fields.', { weekdays: 'These are already the days' });
  let offerId: string | null = null;
  if (d.offerId) {
    const [o] = await db
      .select({ id: membershipOffers.id })
      .from(membershipOffers)
      .where(
        and(
          eq(membershipOffers.id, idOrNotFound(d.offerId, 'Offer')),
          eq(membershipOffers.customerId, customer.id),
          isNull(membershipOffers.closedAt),
        ),
      );
    if (!o) throw new NotFoundError('Offer');
    offerId = o.id;
  }
  const full = await db.transaction((tx) => fullDatesFor(tx, dog.id, plan, startsOn, now));
  if (full.length)
    throw new ValidationError('Please check the highlighted fields.', { weekdays: fullDatesMessage(full) });
  const payload: MembershipDaysPayload = {
    dogId: dog.id,
    dogName: dog.name,
    ...plan,
    startsOn,
    change: Boolean(current),
    offerId,
  };
  const r = await createApprovalRequest(db, me, {
    type: 'membership.days',
    customerId: customer.id,
    subjectKey: subjectKey('dog', dog.id),
    payload,
  });
  return { id: r.id, startsOn };
}

const MoveOnceInput = z.object({ bookingDogId: z.string(), toDate: isoDate('the new day') });

/** "This occasion only": ask to move one membership day inside the same month (membership.move_once, D90). */
export async function requestMyMoveOnce(db: Db, actor: Actor, input: unknown, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'memberships.self.manage', { ownerUserId: customer.userId });
  const d = parseInput(MoveOnceInput, input);
  const [row] = await db
    .select({ bd: bookingDogs, dogName: dogs.name })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .where(and(eq(bookingDogs.id, idOrNotFound(d.bookingDogId, 'Booking')), eq(bookingDogs.customerId, customer.id)));
  if (!row) throw new NotFoundError('Booking');
  const payload: MoveOncePayload = {
    bookingDogId: row.bd.id,
    dogId: row.bd.dogId,
    dogName: row.dogName,
    fromDate: row.bd.serviceDate,
    toDate: d.toDate,
    session: row.bd.session,
  };
  // Same checks as at approval, so the customer hears about a problem now; nothing is held.
  try {
    await db.transaction(async (tx) => {
      await checkMoveOnce(tx, customer.id, payload, now);
    });
  } catch (err) {
    if (err instanceof ConflictError)
      throw new ValidationError('Please check the highlighted fields.', { toDate: err.message });
    throw err;
  }
  const r = await createApprovalRequest(db, me, {
    type: 'membership.move_once',
    customerId: customer.id,
    subjectKey: subjectKey('booking_dog', row.bd.id),
    payload,
  });
  return { id: r.id };
}

// ---- Owner changes days directly (D89) ----------------------------------------------------------

export const OwnerSetDaysInput = z.object({
  weekdays: weekdaysField,
  session: sessionField,
  taxi: checkbox,
  /** Needed when the dog has no membership yet. A change starts from the next month not yet invoiced. */
  startsOn: z.string().trim().optional(),
});

/** Owner sets or changes a dog's regular days, no approval; the customer is emailed (D89). */
export async function ownerSetMembershipDays(db: Db, actor: Actor, rawDogId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'memberships.manage');
  const d = parseInput(OwnerSetDaysInput, input);
  const [dog] = await db
    .select()
    .from(dogs)
    .where(and(eq(dogs.id, idOrNotFound(rawDogId, 'Dog')), isNull(dogs.archivedAt)));
  if (!dog) throw new NotFoundError('Dog');
  const settings = await loadSettings(db);
  const today = londonDate(now);
  const fields: Record<string, string> = {};
  const wd = validWeekdays(d.weekdays, settings.openWeekdays);
  if (wd) fields.weekdays = wd;
  const current = await currentMembership(db, dog.id, today);
  let startsOn: IsoDate;
  if (current) startsOn = await changeStartFor(db, dog.customerId, now);
  else {
    startsOn = d.startsOn ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) fields.startsOn = 'Enter the first day as a real date';
    else if (startsOn <= today) fields.startsOn = 'Choose tomorrow or later';
  }
  if (Object.keys(fields).length) throw new ValidationError('Please check the highlighted fields.', fields);
  const plan: DaysPlan = { weekdays: [...new Set(d.weekdays)].sort(), session: d.session as Session, taxi: d.taxi };
  const [c] = await db.select({ userId: customers.userId }).from(customers).where(eq(customers.id, dog.customerId));
  const id = await db.transaction(async (tx) => {
    const full = await fullDatesFor(tx, dog.id, plan, startsOn, now);
    if (full.length)
      throw new ValidationError('Please check the highlighted fields.', { weekdays: fullDatesMessage(full) });
    const r = await setMembershipDaysTx(tx, actor, {
      ...plan,
      customerId: dog.customerId,
      dogId: dog.id,
      startsOn,
      requestedBy: actor.kind === 'user' ? actor.userId : c!.userId,
      now,
      source: 'owner',
    });
    return r.id;
  });
  const booked = await materialiseMemberships(db, actor, { membershipId: id }, now);
  await refreshMembershipDrafts(db, actor, { customerId: dog.customerId }, now);
  const [who] = await db
    .select({ email: users.email, name: users.name, anonymisedAt: customers.anonymisedAt })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, dog.customerId));
  if (who && !who.anonymisedAt)
    await sendSafely(
      membershipDaysChangedMessage(
        who.email,
        firstNameOf(who.name),
        dog.name,
        describePlan(plan, startsOn).replace(/, from .*$/, ''),
        formatUkDate(startsOn),
        appUrl('/account/bookings'),
      ),
    );
  return { membershipId: id, startsOn, ...booked };
}

// ---- Monthly confirmation (D88) -----------------------------------------------------------------

const MonthInput = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month') });

/** True if the customer has days in `month` that need confirming (joiners' first month excluded, D93). */
async function hasDaysToConfirm(db: Db, customerId: string, month: Month) {
  return (await dogsToConfirm(db, month, customerId)).length > 0;
}

async function confirmByDay(db: Db) {
  const [bs] = await db.select().from(businessSettings).where(eq(businessSettings.id, 1));
  return bs?.confirmByDay ?? 1;
}

/** Confirmation state for the customer's membership page: which months can be confirmed and by when. */
export async function myMonthConfirmations(db: Db, actor: Actor, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'memberships.self.manage', { ownerUserId: customer.userId });
  const byDay = await confirmByDay(db);
  const thisMonth = monthOf(londonDate(now));
  const months = [thisMonth, monthOf(addDays(`${thisMonth}-28`, 7))];
  const done = await db
    .select()
    .from(membershipMonthConfirmations)
    .where(
      and(
        eq(membershipMonthConfirmations.customerId, customer.id),
        inArray(membershipMonthConfirmations.month, months),
      ),
    );
  const out = [];
  for (const m of months) {
    if (!(await hasDaysToConfirm(db, customer.id, m))) continue;
    const c = done.find((x) => x.month === m);
    out.push({
      month: m,
      monthText: formatMonth(m),
      by: confirmByDate(m, byDay),
      confirmedAt: c?.confirmedAt ?? null,
      byOwner: c?.byOwner ?? false,
      late: c?.late ?? false,
    });
  }
  return out;
}

async function recordConfirmation(db: Db, actor: Actor, customerId: string, month: Month, byOwner: boolean, now: Date) {
  if (!(await hasDaysToConfirm(db, customerId, month)))
    throw new ConflictError(
      `There are no membership days to confirm in ${formatMonth(month)}. Days in the month a dog joined are covered by the joining invoice.`,
    );
  const late = isLateConfirmation(month, await confirmByDay(db), londonDate(now));
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(membershipMonthConfirmations)
      .values({
        customerId,
        month,
        confirmedAt: now,
        confirmedBy: actor.kind === 'user' ? actor.userId : null,
        byOwner,
        late,
      })
      .onConflictDoNothing()
      .returning({ id: membershipMonthConfirmations.id });
    if (inserted.length)
      await recordAudit(tx, {
        actor,
        action: byOwner ? 'membership.month_confirmed_by_owner' : 'membership.month_confirmed',
        entityType: 'customer',
        entityId: customerId,
        metadata: { month, late },
      });
  });
}

/** The customer confirms a month's days (D88). Idempotent. After the confirm-by date it's marked late (D94). */
export async function confirmMyMonth(db: Db, actor: Actor, input: unknown, now = new Date()) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'memberships.self.manage', { ownerUserId: customer.userId });
  const { month } = parseInput(MonthInput, input);
  await recordConfirmation(db, me, customer.id, month, false, now);
}

/** The Owner confirms a month's days for the customer (D88). Idempotent; late after the confirm-by date (D94). */
export async function ownerConfirmMonth(db: Db, actor: Actor, rawCustomerId: string, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'memberships.manage');
  const { month } = parseInput(MonthInput, input);
  const id = idOrNotFound(rawCustomerId, 'Customer');
  await recordConfirmation(db, actor, id, month, true, now);
}

export type ConfirmationStatus = 'confirmed' | 'late' | 'unconfirmed';

/**
 * Who has and hasn't confirmed `month`, by customer and dog (D92). Members who joined partway
 * through the month aren't listed (D93). Names only (D33).
 */
export async function monthConfirmationSummary(db: Db, actor: Actor, month: Month) {
  assertAuthorized(actor, 'memberships.manage');
  const [rows, confs] = await Promise.all([
    dogsToConfirm(db, month),
    db.select().from(membershipMonthConfirmations).where(eq(membershipMonthConfirmations.month, month)),
  ]);
  const byCustomer = new Map<
    string,
    { customerId: string; name: string; dogs: string[]; status: ConfirmationStatus; byOwner: boolean }
  >();
  for (const r of rows) {
    let e = byCustomer.get(r.customerId);
    if (!e) {
      const c = confs.find((x) => x.customerId === r.customerId);
      e = {
        customerId: r.customerId,
        name: r.customerName,
        dogs: [],
        status: c ? (c.late ? 'late' : 'confirmed') : 'unconfirmed',
        byOwner: c?.byOwner ?? false,
      };
      byCustomer.set(r.customerId, e);
    }
    e.dogs.push(r.dogName);
  }
  return [...byCustomer.values()];
}

/** Members with days in `month` who haven't confirmed them (Owner dashboard, D88/D93). */
export async function unconfirmedMembers(db: Db, actor: Actor, month: Month) {
  return (await monthConfirmationSummary(db, actor, month))
    .filter((r) => r.status === 'unconfirmed')
    .map(({ customerId, name, dogs }) => ({ customerId, name, dogs }));
}

/**
 * Job (D88), from the day after the confirm-by day: days that weren't confirmed are KEPT and the
 * Owner gets one summary email for the month listing who has confirmed (on time or late) and who
 * hasn't, by customer and dog (D92). Names only, nothing else about the customer (D33).
 */
export async function notifyUnconfirmedDays(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'jobs.run');
  const month = monthOf(londonDate(now));
  const summary = await monthConfirmationSummary(db, actor, month);
  const pick = (st: ConfirmationStatus) =>
    summary.filter((r) => r.status === st).map((r) => ({ name: r.name, dogs: r.dogs, byOwner: r.byOwner }));
  const groups = { unconfirmed: pick('unconfirmed'), late: pick('late'), confirmed: pick('confirmed') };
  if (summary.length) {
    const byText = formatUkDate(confirmByDate(month, await confirmByDay(db)));
    for (const to of await ownerEmails(db))
      await sendSafely(
        ownerConfirmationSummaryMessage(to, { monthText: formatMonth(month), byText, ...groups }, appUrl('/admin')),
      );
  }
  return {
    month,
    unconfirmed: groups.unconfirmed.length,
    late: groups.late.length,
    confirmed: groups.confirmed.length,
  };
}

/** Owner's membership view for one customer: dogs' days, open offers and this/next month's confirmations. */
export async function ownerMembershipOverview(db: Db, actor: Actor, rawCustomerId: string, now = new Date()) {
  assertAuthorized(actor, 'memberships.manage');
  const id = idOrNotFound(rawCustomerId, 'Customer');
  const today = londonDate(now);
  const [offers, myDogs, confs] = await Promise.all([
    db
      .select()
      .from(membershipOffers)
      .where(and(eq(membershipOffers.customerId, id), isNull(membershipOffers.closedAt)))
      .orderBy(asc(membershipOffers.createdAt)),
    db
      .select({ id: dogs.id, name: dogs.name })
      .from(dogs)
      .where(and(eq(dogs.customerId, id), isNull(dogs.archivedAt)))
      .orderBy(asc(dogs.name)),
    db.select().from(membershipMonthConfirmations).where(eq(membershipMonthConfirmations.customerId, id)),
  ]);
  const thisMonth = monthOf(today);
  const months: {
    month: Month;
    monthText: string;
    hasDays: boolean;
    confirmedAt: Date | null;
    byOwner: boolean;
    late: boolean;
  }[] = [];
  for (const m of [thisMonth, monthOf(addDays(`${thisMonth}-28`, 7))]) {
    const c = confs.find((x) => x.month === m);
    months.push({
      month: m,
      monthText: formatMonth(m),
      hasDays: await hasDaysToConfirm(db, id, m),
      confirmedAt: c?.confirmedAt ?? null,
      byOwner: c?.byOwner ?? false,
      late: c?.late ?? false,
    });
  }
  return {
    offers,
    dogs: await Promise.all(myDogs.map(async (d) => ({ ...d, membership: await currentMembership(db, d.id, today) }))),
    months,
    changeFrom: await changeStartFor(db, id, now),
  };
}
