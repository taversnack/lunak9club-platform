import 'server-only';
import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import {
  bookingDogs,
  complianceRequirements,
  complianceSubmissions,
  customers,
  dogs,
  notificationLog,
  users,
} from '@/infra/db/schema';
import {
  bookingReminderMessage,
  offerLapsingMessage,
  ownerBillingMessage,
  vaccinationReminderMessage,
} from '@/infra/email/templates';
import { vaccinationReminderDue } from '@/domain/compliance/welfare';
import type { Session } from '@/domain/booking/rules';
import { addDays, formatUkDate, londonDate } from '@/domain/time';
import { formatDateTimeLondon } from '@/ui/format';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { appUrl, firstNameOf, ownerEmails, sendSafely } from '../notify';
import { describeSession } from './booking-shared';

type Q = Pick<Db, 'insert'>;

/** Claim a reminder so it is only ever sent once, however often the scheduler runs. */
export async function claimNotification(db: Q, key: string, kind: string): Promise<boolean> {
  const rows = await db
    .insert(notificationLog)
    .values({ key, kind })
    .onConflictDoNothing({ target: notificationLog.key })
    .returning({ key: notificationLog.key });
  return rows.length > 0;
}

/**
 * Vaccination reminders (D11, D66): 30, 14 and 7 days before a mandatory vaccination expires
 * (per requirement settings), and once when it has expired – to the customer, and a daily summary
 * of expiries to the Owner. Emails name the dog only, never the vaccination (D33).
 */
export async function sendVaccinationReminders(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'jobs.run');
  const today = londonDate(now);
  // Latest approved expiry per dog and vaccination, for active dogs of customers still with us.
  const rows = await db
    .select({
      dogId: dogs.id,
      dogName: dogs.name,
      requirementKey: complianceSubmissions.requirementKey,
      thresholds: complianceRequirements.reminderDays,
      expiresOn: sql<string>`max(${complianceSubmissions.expiresOn})::text`,
      email: users.email,
      name: users.name,
    })
    .from(complianceSubmissions)
    .innerJoin(complianceRequirements, eq(complianceRequirements.key, complianceSubmissions.requirementKey))
    .innerJoin(dogs, eq(dogs.id, complianceSubmissions.dogId))
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(
      and(
        eq(complianceSubmissions.status, 'approved'),
        eq(complianceRequirements.kind, 'vaccination'),
        eq(complianceRequirements.mandatory, true),
        eq(complianceRequirements.active, true),
        isNull(dogs.archivedAt),
        isNull(customers.anonymisedAt),
        inArray(dogs.status, ['approved', 'pending_review', 'suspended']),
      ),
    )
    .groupBy(
      dogs.id,
      dogs.name,
      complianceSubmissions.requirementKey,
      complianceRequirements.reminderDays,
      users.email,
      users.name,
    );

  let sent = 0;
  const expiredToday: string[] = [];
  for (const r of rows) {
    const due = vaccinationReminderDue(r.expiresOn, today, r.thresholds);
    if (due === null) continue;
    const key = `vaccination:${r.dogId}:${r.requirementKey}:${r.expiresOn}:${due}`;
    if (!(await claimNotification(db, key, 'vaccination'))) continue;
    await sendSafely(
      vaccinationReminderMessage(
        r.email,
        firstNameOf(r.name),
        { dogName: r.dogName, expired: due === 'expired', dateText: formatUkDate(r.expiresOn) },
        appUrl(`/account/dogs/${r.dogId}`),
      ),
    );
    if (due === 'expired') expiredToday.push(r.dogName);
    sent++;
  }
  if (expiredToday.length && (await claimNotification(db, `vaccination-owner:${today}`, 'vaccination-owner'))) {
    for (const to of await ownerEmails(db))
      await sendSafely(
        ownerBillingMessage(
          to,
          `${expiredToday.length} vaccination record${expiredToday.length === 1 ? '' : 's'} expired`,
          `Records have expired for: ${[...new Set(expiredToday)].join(', ')}. Bookings after the expiry date are blocked until a new record is approved. The customers have been emailed.`,
          appUrl('/admin'),
        ),
      );
  }
  if (sent)
    await recordAudit(db, { actor, action: 'reminder.vaccinations_sent', entityType: 'dog', metadata: { sent } });
  return { sent };
}

/** Day-before booking reminder (sent from 17:00), one email per customer per day (D67). */
export async function sendBookingReminders(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'jobs.run');
  const tomorrow = addDays(londonDate(now), 1);
  const rows = await db
    .select({
      customerId: bookingDogs.customerId,
      dogName: dogs.name,
      session: bookingDogs.session,
      taxi: bookingDogs.taxi,
      email: users.email,
      name: users.name,
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .innerJoin(customers, eq(customers.id, bookingDogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(
      and(eq(bookingDogs.serviceDate, tomorrow), eq(bookingDogs.status, 'confirmed'), isNull(customers.anonymisedAt)),
    );
  const byCustomer = new Map<string, typeof rows>();
  for (const r of rows) byCustomer.set(r.customerId, [...(byCustomer.get(r.customerId) ?? []), r]);
  let sent = 0;
  for (const [customerId, list] of byCustomer) {
    if (!(await claimNotification(db, `booking-reminder:${customerId}:${tomorrow}`, 'booking-reminder'))) continue;
    await sendSafely(
      bookingReminderMessage(
        list[0]!.email,
        firstNameOf(list[0]!.name),
        list.map((r) => ({
          dogName: r.dogName,
          ...describeSession(tomorrow, r.session as Session),
          outcome: r.taxi ? 'with taxi – we’ll confirm collection times this evening' : 'booked',
        })),
        appUrl('/account/bookings'),
      ),
    );
    sent++;
  }
  return { sent };
}

/** Warn the customer when a waitlist place offer has 2 hours or less left (D67). */
export async function sendOfferWarnings(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'jobs.run');
  const soon = new Date(now.getTime() + 2 * 3_600_000);
  const rows = await db
    .select({
      id: bookingDogs.id,
      serviceDate: bookingDogs.serviceDate,
      session: bookingDogs.session,
      offerExpiresAt: bookingDogs.offerExpiresAt,
      dogName: dogs.name,
      email: users.email,
      name: users.name,
    })
    .from(bookingDogs)
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .innerJoin(customers, eq(customers.id, bookingDogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(
      and(
        eq(bookingDogs.status, 'offered'),
        gt(bookingDogs.offerExpiresAt, now),
        lte(bookingDogs.offerExpiresAt, soon),
      ),
    );
  let sent = 0;
  for (const r of rows) {
    const key = `offer-warning:${r.id}:${r.offerExpiresAt!.toISOString()}`;
    if (!(await claimNotification(db, key, 'offer-warning'))) continue;
    await sendSafely(
      offerLapsingMessage(
        r.email,
        firstNameOf(r.name),
        { dogName: r.dogName, ...describeSession(r.serviceDate, r.session as Session), outcome: 'place held for you' },
        formatDateTimeLondon(r.offerExpiresAt!),
        appUrl('/account/bookings'),
      ),
    );
    sent++;
  }
  return { sent };
}

/** Owner dashboard: mandatory vaccinations expiring in the next 30 days (or already expired) for active dogs. */
export async function expiringVaccinations(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'compliance.review');
  const today = londonDate(now);
  const rows = await db
    .select({
      dogId: dogs.id,
      dogName: dogs.name,
      label: complianceRequirements.label,
      expiresOn: sql<string>`max(${complianceSubmissions.expiresOn})::text`,
    })
    .from(complianceSubmissions)
    .innerJoin(complianceRequirements, eq(complianceRequirements.key, complianceSubmissions.requirementKey))
    .innerJoin(dogs, eq(dogs.id, complianceSubmissions.dogId))
    .where(
      and(
        eq(complianceSubmissions.status, 'approved'),
        eq(complianceRequirements.kind, 'vaccination'),
        eq(complianceRequirements.mandatory, true),
        eq(dogs.status, 'approved'),
        isNull(dogs.archivedAt),
      ),
    )
    .groupBy(dogs.id, dogs.name, complianceRequirements.label);
  return rows
    .filter((r) => r.expiresOn <= addDays(today, 30))
    .map((r) => ({ ...r, expired: r.expiresOn < today }))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}
