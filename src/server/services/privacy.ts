import 'server-only';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, max, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import type { StorageProvider } from '@/infra/storage';
import {
  accounts,
  auditEvents,
  bookingDogs,
  checkoutAttempts,
  complianceSubmissions,
  contacts,
  customers,
  dataRequests,
  documents,
  dogBehaviourProfiles,
  dogHealthProfiles,
  dogPermissions,
  dogs,
  incidents,
  invoices,
  jobRuns,
  memberships,
  incidentPhotos,
  notificationLog,
  policyAcknowledgements,
  policyVersions,
  priceSnapshots,
  rateLimits,
  sessions,
  users,
  verifications,
  vets,
  webhookEvents,
  welfareChecks,
} from '@/infra/db/schema';
import { personalDataRetainUntil, retentionCutoffs } from '@/domain/compliance/welfare';
import { formatUkDate, londonDate } from '@/domain/time';
import { erasureDecisionMessage, ownerBillingMessage } from '@/infra/email/templates';
import { logger } from '@/infra/logger';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { appUrl, firstNameOf, ownerEmails, sendSafely } from '../notify';
import { idOrNotFound, optionalText, parseInput } from '../validation';
import { asUser, getMyCustomer } from './customers';
import { balances } from './billing';
import { myIncidents } from './welfare';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const SYSTEM: Actor = { kind: 'system', job: 'retention' };
const LIVE = ['confirmed', 'pending_payment', 'waitlisted', 'offered'] as const;

/** Address used once a customer's real email has been removed. Never deliverable. */
const erasedEmail = (customerId: string) => `erased-${customerId}@invalid.lunak9club.test`;

// ---- Customer data export (UK GDPR right of access, D65) -------------------------------

/** Everything we hold about the signed-in customer, as JSON. Files are listed, not included. */
export async function exportMyData(db: Db, actor: Actor) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'data.self.manage', { ownerUserId: customer.userId });
  const [user] = await db
    .select({ name: users.name, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, me.userId));
  const myDogs = await db.select().from(dogs).where(eq(dogs.customerId, customer.id));
  const dogIds = myDogs.map((d) => d.id);
  const any = (ids: string[]) => (ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const [
    myContacts,
    myVets,
    health,
    behaviour,
    perms,
    bookingRows,
    mems,
    invs,
    docs,
    acks,
    incidentList,
    checks,
    requests,
  ] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.customerId, customer.id)),
    db.select().from(vets).where(eq(vets.customerId, customer.id)),
    db
      .select()
      .from(dogHealthProfiles)
      .where(inArray(dogHealthProfiles.dogId, any(dogIds))),
    db
      .select()
      .from(dogBehaviourProfiles)
      .where(inArray(dogBehaviourProfiles.dogId, any(dogIds))),
    db
      .select()
      .from(dogPermissions)
      .where(inArray(dogPermissions.dogId, any(dogIds))),
    db
      .select({
        dogId: bookingDogs.dogId,
        date: bookingDogs.serviceDate,
        session: bookingDogs.session,
        taxi: bookingDogs.taxi,
        status: bookingDogs.status,
        kind: bookingDogs.kind,
        customerNote: bookingDogs.customerNote,
        pricePence: priceSnapshots.totalPence,
      })
      .from(bookingDogs)
      .leftJoin(priceSnapshots, eq(priceSnapshots.bookingDogId, bookingDogs.id))
      .where(eq(bookingDogs.customerId, customer.id)),
    db.select().from(memberships).where(eq(memberships.customerId, customer.id)),
    db
      .select({
        number: invoices.number,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        totalPence: invoices.totalPence,
        status: invoices.status,
      })
      .from(invoices)
      .where(and(eq(invoices.customerId, customer.id), isNotNull(invoices.number))),
    db
      .select({
        name: documents.displayName,
        type: documents.contentType,
        uploadedAt: documents.uploadedAt,
        purpose: documents.purpose,
      })
      .from(documents)
      .where(eq(documents.customerId, customer.id)),
    db
      .select({
        policy: policyVersions.title,
        version: policyVersions.version,
        acceptedAt: policyAcknowledgements.acknowledgedAt,
      })
      .from(policyAcknowledgements)
      .innerJoin(policyVersions, eq(policyVersions.id, policyAcknowledgements.policyVersionId))
      .where(eq(policyAcknowledgements.userId, me.userId)),
    myIncidents(db, me),
    db
      .select({
        dogId: welfareChecks.dogId,
        date: welfareChecks.serviceDate,
        ate: welfareChecks.ate,
        drinking: welfareChecks.drinking,
        mood: welfareChecks.mood,
        note: welfareChecks.note,
      })
      .from(welfareChecks)
      .where(and(inArray(welfareChecks.dogId, any(dogIds)), eq(welfareChecks.shared, true))),
    db.select().from(dataRequests).where(eq(dataRequests.customerId, customer.id)),
  ]);
  await recordAudit(db, { actor: me, action: 'data.exported', entityType: 'customer', entityId: customer.id });
  return {
    exportedAt: new Date().toISOString(),
    controller: 'Luna’s K9 Club Ltd',
    account: user,
    profile: {
      phone: customer.phone,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      town: customer.town,
      postcode: customer.postcode,
    },
    contacts: myContacts.map(({ customerId: _c, ...c }) => (void _c, c)),
    vets: myVets.map(({ customerId: _c, ...v }) => (void _c, v)),
    dogs: myDogs.map((d) => ({
      ...d,
      health: health.find((h) => h.dogId === d.id) ?? null,
      behaviour: behaviour.find((b) => b.dogId === d.id) ?? null,
      permissions: perms.find((p) => p.dogId === d.id) ?? null,
    })),
    bookings: bookingRows,
    memberships: mems,
    invoices: invs,
    documents: docs,
    termsAccepted: acks,
    incidentReports: incidentList,
    sharedDailyNotes: checks,
    dataRequests: requests,
  };
}

// ---- Erasure requests (UK GDPR right to erasure, D65) ----------------------------------

export const ErasureRequestInput = z.object({ reason: optionalText(1000) });

export async function requestErasure(db: Db, actor: Actor, input: unknown) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'data.self.manage', { ownerUserId: customer.userId });
  const d = parseInput(ErasureRequestInput, input);
  const [open] = await db
    .select({ id: dataRequests.id })
    .from(dataRequests)
    .where(and(eq(dataRequests.customerId, customer.id), eq(dataRequests.status, 'requested')));
  if (open) throw new ConflictError('You’ve already asked to delete your account. We’ll be in touch.');
  const [row] = await db
    .insert(dataRequests)
    .values({ customerId: customer.id, customerReason: d.reason })
    .returning({ id: dataRequests.id });
  await recordAudit(db, { actor: me, action: 'data.erasure_requested', entityType: 'data_request', entityId: row!.id });
  for (const to of await ownerEmails(db))
    await sendSafely(
      ownerBillingMessage(
        to,
        'A customer asked to delete their account',
        'Please review the request. UK GDPR expects a reply within one month.',
        appUrl('/admin/data-requests'),
      ),
    );
  return row!.id;
}

export async function withdrawErasureRequest(db: Db, actor: Actor) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'data.self.manage', { ownerUserId: customer.userId });
  const rows = await db
    .delete(dataRequests)
    .where(and(eq(dataRequests.customerId, customer.id), eq(dataRequests.status, 'requested')))
    .returning({ id: dataRequests.id });
  if (!rows.length) throw new ConflictError('There’s no request waiting to withdraw.');
  await recordAudit(db, { actor: me, action: 'data.erasure_withdrawn', entityType: 'customer', entityId: customer.id });
}

export async function myDataRequests(db: Db, actor: Actor) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'data.self.manage', { ownerUserId: customer.userId });
  return db
    .select()
    .from(dataRequests)
    .where(eq(dataRequests.customerId, customer.id))
    .orderBy(desc(dataRequests.requestedAt));
}

/** Things that must be sorted before an account can be closed. */
async function erasureBlockers(q: Db | Tx, customerId: string, today: string) {
  const blockers: string[] = [];
  const [future] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.customerId, customerId),
        gte(bookingDogs.serviceDate, today),
        inArray(bookingDogs.status, [...LIVE]),
      ),
    );
  if (future?.n) blockers.push(`${future.n} upcoming booking${future.n === 1 ? '' : 's'} to cancel`);
  const [mem] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(
      and(
        eq(memberships.customerId, customerId),
        inArray(memberships.status, ['requested', 'active']),
        or(isNull(memberships.endsOn), gte(memberships.endsOn, today)),
      ),
    );
  if (mem?.n) blockers.push('a membership to end');
  const open = await q
    .select({ id: invoices.id, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.customerId, customerId), inArray(invoices.status, ['draft', 'scheduled', 'issued'])));
  const bals = await balances(
    q,
    open.filter((o) => o.status === 'issued').map((o) => o.id),
  );
  if ([...bals.values()].some((b) => b.duePence > 0)) blockers.push('an unpaid invoice');
  if (open.some((o) => o.status !== 'issued')) blockers.push('an invoice draft to approve or let lapse');
  const [checkout] = await q
    .select({ n: sql<number>`count(*)::int` })
    .from(checkoutAttempts)
    .where(and(eq(checkoutAttempts.customerId, customerId), eq(checkoutAttempts.status, 'open')));
  if (checkout?.n) blockers.push('a payment in progress');
  return blockers;
}

async function lastVisit(q: Db | Tx, customerId: string, today: string) {
  const [row] = await q
    .select({ d: max(bookingDogs.serviceDate) })
    .from(bookingDogs)
    .where(
      and(
        eq(bookingDogs.customerId, customerId),
        lte(bookingDogs.serviceDate, today),
        inArray(bookingDogs.status, ['attended', 'no_show', 'confirmed']),
      ),
    );
  return row?.d ?? null;
}

export async function ownerDataRequests(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'data_requests.manage');
  const today = londonDate(now);
  const rows = await db
    .select({ r: dataRequests, customerName: users.name })
    .from(dataRequests)
    .innerJoin(customers, eq(customers.id, dataRequests.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .orderBy(desc(dataRequests.requestedAt))
    .limit(100);
  const out = [];
  for (const row of rows)
    out.push({
      ...row,
      blockers: row.r.status === 'requested' ? await erasureBlockers(db, row.r.customerId, today) : [],
    });
  return out;
}

export const ErasureDecisionInput = z.object({ reason: optionalText(1000) });

/**
 * Owner decides an erasure request (D65). Approving closes the account straight away (no sign-in,
 * real email removed). Licence and financial records are kept for their legal periods (D64), so
 * the remaining personal details are anonymised now if that period has passed, otherwise by the
 * retention job on `retain_until`.
 */
export async function decideErasure(
  db: Db,
  storage: StorageProvider,
  actor: Actor,
  rawId: string,
  approve: boolean,
  input: unknown,
  now = new Date(),
) {
  assertAuthorized(actor, 'data_requests.manage');
  const d = parseInput(ErasureDecisionInput, input);
  if (!approve && !d.reason)
    throw new ValidationError('Please check the highlighted fields.', {
      reason: 'Enter a reason the customer will see',
    });
  const id = idOrNotFound(rawId, 'Request');
  const today = londonDate(now);
  const by = actor.kind === 'user' ? actor.userId : null;
  const result = await db.transaction(async (tx) => {
    const [req] = await tx.select().from(dataRequests).where(eq(dataRequests.id, id)).for('update');
    if (!req) throw new NotFoundError('Request');
    if (req.status !== 'requested') throw new ConflictError('This request has already been decided.');
    const [who] = await tx
      .select({ email: users.email, name: users.name, userId: users.id, c: customers })
      .from(customers)
      .innerJoin(users, eq(users.id, customers.userId))
      .where(eq(customers.id, req.customerId));
    if (!who) throw new NotFoundError('Customer');
    if (!approve) {
      await tx
        .update(dataRequests)
        .set({ status: 'declined', decisionReason: d.reason, decidedBy: by, decidedAt: now })
        .where(eq(dataRequests.id, id));
      await recordAudit(tx, { actor, action: 'data.erasure_declined', entityType: 'data_request', entityId: id });
      return { who, retainUntil: null as string | null, completed: false };
    }
    const blockers = await erasureBlockers(tx, req.customerId, today);
    if (blockers.length) throw new ConflictError(`Before closing this account, sort out: ${blockers.join('; ')}.`);
    const retainUntil = personalDataRetainUntil(
      await lastVisit(tx, req.customerId, today),
      londonDate(who.c.createdAt),
    );
    // Close the account now: no sign-in, and the real email address is removed.
    await tx.delete(sessions).where(eq(sessions.userId, who.userId));
    await tx.delete(accounts).where(eq(accounts.userId, who.userId));
    await tx.delete(verifications).where(eq(verifications.identifier, who.email));
    await tx
      .update(users)
      .set({ email: erasedEmail(req.customerId), emailVerified: false })
      .where(eq(users.id, who.userId));
    await tx
      .update(customers)
      .set({ archivedAt: who.c.archivedAt ?? now })
      .where(eq(customers.id, req.customerId));
    await tx
      .update(dogs)
      .set({ archivedAt: now })
      .where(and(eq(dogs.customerId, req.customerId), isNull(dogs.archivedAt)));
    await tx
      .update(dataRequests)
      .set({ status: 'approved', decidedBy: by, decidedAt: now, decisionReason: d.reason, retainUntil })
      .where(eq(dataRequests.id, id));
    await recordAudit(tx, {
      actor,
      action: 'data.erasure_approved',
      entityType: 'data_request',
      entityId: id,
      metadata: { retainUntil },
    });
    return { who, retainUntil, completed: false };
  });
  let completed = false;
  if (approve && result.retainUntil && result.retainUntil <= today) {
    await anonymiseCustomer(db, storage, result.who.c.id, now);
    completed = true;
  }
  await sendSafely(
    erasureDecisionMessage(result.who.email, firstNameOf(result.who.name), {
      approved: approve,
      retainUntilText: approve && !completed && result.retainUntil ? formatUkDate(result.retainUntil) : null,
      reason: d.reason,
    }),
  );
  return { retainUntil: result.retainUntil, completed };
}

// ---- Anonymisation and retention (D64) -------------------------------------------------

/**
 * Remove a customer's personal details. Bookings (anonymous), invoices and payments (6 years,
 * HMRC) stay; profile, contacts, vets, dog details, health/behaviour records, documents, incident
 * reports and daily notes go. Only called once the licence period for those records has passed.
 */
export async function anonymiseCustomer(db: Db, storage: StorageProvider, customerId: string, now = new Date()) {
  const files: string[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lunak9.retention', 'on', true)`);
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).for('update');
    if (!c || c.anonymisedAt) return;
    const myDogs = await tx.select({ id: dogs.id }).from(dogs).where(eq(dogs.customerId, customerId));
    const dogIds = myDogs.map((d) => d.id);
    const docs = await tx
      .select({ id: documents.id, key: documents.storageKey })
      .from(documents)
      .where(eq(documents.customerId, customerId));
    files.push(...docs.map((d) => d.key));
    if (dogIds.length) {
      await tx.delete(welfareChecks).where(inArray(welfareChecks.dogId, dogIds));
      await tx.delete(incidents).where(inArray(incidents.dogId, dogIds));
      await tx.delete(complianceSubmissions).where(inArray(complianceSubmissions.dogId, dogIds));
      await tx.delete(dogHealthProfiles).where(inArray(dogHealthProfiles.dogId, dogIds));
      await tx.delete(dogBehaviourProfiles).where(inArray(dogBehaviourProfiles.dogId, dogIds));
      await tx.delete(dogPermissions).where(inArray(dogPermissions.dogId, dogIds));
    }
    if (docs.length)
      await tx.delete(documents).where(
        inArray(
          documents.id,
          docs.map((d) => d.id),
        ),
      );
    await tx
      .update(dogs)
      .set({
        name: 'Former dog',
        breed: null,
        sex: null,
        dateOfBirth: null,
        weightKg: null,
        microchipNumber: null,
        vetId: null,
        statusReason: null,
        archivedAt: sql`coalesce(${dogs.archivedAt}, now())`,
      })
      .where(eq(dogs.customerId, customerId));
    await tx.delete(contacts).where(eq(contacts.customerId, customerId));
    await tx.delete(vets).where(eq(vets.customerId, customerId));
    await tx
      .update(bookingDogs)
      .set({ customerNote: null, internalNote: null })
      .where(eq(bookingDogs.customerId, customerId));
    await tx
      .update(customers)
      .set({
        phone: null,
        addressLine1: null,
        addressLine2: null,
        town: null,
        postcode: null,
        anonymisedAt: now,
        archivedAt: c.archivedAt ?? now,
      })
      .where(eq(customers.id, customerId));
    await tx.delete(sessions).where(eq(sessions.userId, c.userId));
    await tx.delete(accounts).where(eq(accounts.userId, c.userId));
    await tx
      .update(users)
      .set({ name: 'Former customer', email: erasedEmail(customerId), emailVerified: false, image: null })
      .where(eq(users.id, c.userId));
    await tx
      .update(dataRequests)
      .set({ status: 'completed', completedAt: now })
      .where(and(eq(dataRequests.customerId, customerId), eq(dataRequests.status, 'approved')));
    await recordAudit(tx, {
      actor: SYSTEM,
      action: 'customer.anonymised',
      entityType: 'customer',
      entityId: customerId,
    });
  });
  for (const key of files) await storage.delete(key).catch(() => logger.warn({}, 'retention: file already gone'));
}

/**
 * Daily retention job (D64). Deletes licence records after 3 years, documents 3 years after the
 * record they prove expired, technical data after 90 days and audit events after 6 years, and
 * anonymises customers who have been inactive for 3 years or whose erasure request is due.
 * Invoices and payments are kept for 6 years (their deletion is due from 2032 – see O14).
 */
export async function runRetention(db: Db, storage: StorageProvider, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'jobs.run');
  const today = londonDate(now);
  const cut = retentionCutoffs(today);
  const at = (date: string) => new Date(`${date}T00:00:00Z`);
  const files: string[] = [];
  const counts = await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('lunak9.retention', 'on', true)`);
    await tx.execute(sql`select set_config('lunak9.audit_maintenance', 'on', true)`);
    const checks = await tx
      .delete(welfareChecks)
      .where(lt(welfareChecks.createdAt, at(cut.licence)))
      .returning({ id: welfareChecks.id });
    // Closed incidents older than 3 years, with their photos.
    const oldIncidents = await tx
      .select({ id: incidents.id })
      .from(incidents)
      .where(and(eq(incidents.status, 'closed'), lt(incidents.createdAt, at(cut.licence))));
    let incidentCount = 0;
    if (oldIncidents.length) {
      const ids = oldIncidents.map((i) => i.id);
      const photos = await tx
        .select({ id: documents.id, key: documents.storageKey })
        .from(incidentPhotos)
        .innerJoin(documents, eq(documents.id, incidentPhotos.documentId))
        .where(inArray(incidentPhotos.incidentId, ids));
      files.push(...photos.map((r) => r.key));
      await tx.delete(incidents).where(inArray(incidents.id, ids));
      if (photos.length)
        await tx.delete(documents).where(
          inArray(
            documents.id,
            photos.map((r) => r.id),
          ),
        );
      incidentCount = ids.length;
    }
    // Vaccination records 3 years after they expired; then documents nothing refers to any more.
    const subs = await tx
      .delete(complianceSubmissions)
      .where(lt(complianceSubmissions.expiresOn, cut.documents))
      .returning({ id: complianceSubmissions.id });
    const orphanDocs = await tx
      .select({ id: documents.id, key: documents.storageKey })
      .from(documents)
      .where(
        and(
          eq(documents.purpose, 'compliance'),
          lt(documents.uploadedAt, at(cut.documents)),
          sql`not exists (select 1 from compliance_submissions s where s.document_id = ${documents.id})`,
        ),
      );
    if (orphanDocs.length) {
      files.push(...orphanDocs.map((d) => d.key));
      await tx.delete(documents).where(
        inArray(
          documents.id,
          orphanDocs.map((d) => d.id),
        ),
      );
    }
    // Technical data.
    await tx.delete(sessions).where(lt(sessions.expiresAt, at(cut.technical)));
    await tx.delete(verifications).where(lt(verifications.expiresAt, at(cut.technical)));
    await tx.delete(rateLimits).where(lt(rateLimits.lastRequest, at(cut.technical).getTime()));
    await tx.delete(webhookEvents).where(lt(webhookEvents.receivedAt, at(cut.technical)));
    await tx.delete(notificationLog).where(lt(notificationLog.sentAt, at(cut.technical)));
    await tx.delete(jobRuns).where(and(lt(jobRuns.startedAt, at(cut.technical)), ne(jobRuns.status, 'running')));
    const audit = await tx
      .delete(auditEvents)
      .where(lt(auditEvents.occurredAt, at(cut.financial)))
      .returning({ id: auditEvents.id });
    return {
      welfareChecks: checks.length,
      incidents: incidentCount,
      vaccinationRecords: subs.length,
      documents: orphanDocs.length,
      auditEvents: audit.length,
    };
  });
  for (const key of files) await storage.delete(key).catch(() => logger.warn({}, 'retention: file already gone'));

  // Customers: approved erasure requests that are now due, and anyone inactive for 3 years.
  const due = await db
    .select({ customerId: dataRequests.customerId })
    .from(dataRequests)
    .where(and(eq(dataRequests.status, 'approved'), lte(dataRequests.retainUntil, today)));
  const inactive = await db
    .select({ id: customers.id })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(
      and(
        isNull(customers.anonymisedAt),
        lt(customers.createdAt, at(cut.licence)),
        sql`not exists (select 1 from user_roles r where r.user_id = ${users.id} and r.role_key = 'owner')`,
        sql`not exists (select 1 from booking_dogs b where b.customer_id = ${customers.id} and (b.service_date >= ${cut.licence} or b.created_at >= ${at(cut.licence)}))`,
        sql`not exists (select 1 from sessions s where s.user_id = ${users.id} and s.updated_at >= ${at(cut.licence)})`,
      ),
    );
  let anonymised = 0;
  for (const id of new Set([...due.map((d) => d.customerId), ...inactive.map((c) => c.id)])) {
    if ((await erasureBlockers(db, id, today)).length) continue;
    await anonymiseCustomer(db, storage, id, now);
    anonymised++;
  }
  const summary = { ...counts, customersAnonymised: anonymised };
  await recordAudit(db, { actor, action: 'retention.run', entityType: 'retention', metadata: summary });
  return summary;
}
