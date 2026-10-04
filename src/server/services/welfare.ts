import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import type { StorageProvider } from '@/infra/storage';
import {
  customers,
  documents,
  dogs,
  incidentPhotos,
  incidents,
  incidentUpdates,
  users,
  welfareChecks,
  INCIDENT_KINDS,
  INCIDENT_SEVERITIES,
} from '@/infra/db/schema';
import { checkUpload, safeDisplayName } from '@/domain/documents/file-type';
import { welfareConcerns } from '@/domain/compliance/welfare';
import { isIsoDate, londonDate, londonInstant } from '@/domain/time';
import { incidentMessage, welfareNoteMessage } from '@/infra/email/templates';
import { logger } from '@/infra/logger';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { appUrl, firstNameOf, sendSafely } from '../notify';
import { checkbox, idOrNotFound, isoDate, optionalText, parseInput, requiredText } from '../validation';
import { asUser, getMyCustomer } from './customers';

const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

async function dogWithOwner(db: Db, dogId: string) {
  const [row] = await db
    .select({ dog: dogs, email: users.email, name: users.name, customerUserId: users.id })
    .from(dogs)
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(dogs.id, idOrNotFound(dogId, 'Dog')));
  if (!row) throw new NotFoundError('Dog');
  return row;
}

// ---- Incidents (D62) -----------------------------------------------------------------

export const IncidentInput = z.object({
  dogId: z.string(),
  occurredOn: isoDate('the date it happened'),
  occurredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter the time, like 14:30'),
  kind: z.enum(INCIDENT_KINDS, { message: 'Choose what kind of incident it was' }),
  severity: z.enum(INCIDENT_SEVERITIES, { message: 'Choose how serious it was' }),
  description: requiredText('what happened', 4000),
  actionTaken: requiredText('what you did', 4000),
  vetContacted: checkbox,
  vetAdvice: optionalText(2000),
  internalNotes: optionalText(4000),
  followUpDue: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isIsoDate(v), 'Enter a real date'),
  bookingDogId: z.string().optional(),
});

export type PhotoUpload = { fileName: string; bytes: Uint8Array };

/**
 * Owner records an incident. The customer is always emailed (D62) – the email only says there's a
 * report to read; the details are in their account. Photos are checked by content and stored privately.
 */
export async function reportIncident(
  db: Db,
  storage: StorageProvider,
  actor: Actor,
  input: unknown,
  photos: PhotoUpload[] = [],
  now = new Date(),
) {
  assertAuthorized(actor, 'incidents.manage');
  const d = parseInput(IncidentInput, input);
  const fields: Record<string, string> = {};
  const occurredAt = londonInstant(d.occurredOn, d.occurredTime);
  if (occurredAt > now) fields.occurredOn = 'This can’t be in the future';
  if (d.vetContacted && !d.vetAdvice) fields.vetAdvice = 'Enter what the vet advised';
  if (photos.length > MAX_PHOTOS) fields.photos = `Add up to ${MAX_PHOTOS} photos`;
  const checked = photos.map((p) => ({ ...p, check: checkUpload(p.bytes) }));
  for (const p of checked) {
    if (p.bytes.byteLength > MAX_PHOTO_BYTES) fields.photos = 'Each photo must be 10 MB or smaller';
    else if (!p.check.ok) fields.photos = p.check.message;
  }
  if (Object.keys(fields).length) throw new ValidationError('Please check the highlighted fields.', fields);
  const owner = await dogWithOwner(db, d.dogId);
  const by = actor.kind === 'user' ? actor.userId : null;

  const stored: { key: string; mime: string; p: (typeof checked)[number] }[] = [];
  for (const p of checked) {
    if (!p.check.ok) continue;
    const key = `customers/${owner.dog.customerId}/dogs/${owner.dog.id}/incidents/${randomUUID()}`;
    await storage.put(key, p.bytes, p.check.type.mime);
    stored.push({ key, mime: p.check.type.mime, p });
  }
  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(incidents)
        .values({
          dogId: owner.dog.id,
          customerId: owner.dog.customerId,
          bookingDogId: d.bookingDogId ? idOrNotFound(d.bookingDogId, 'Booking') : null,
          occurredAt,
          kind: d.kind,
          severity: d.severity,
          description: d.description,
          actionTaken: d.actionTaken,
          vetContacted: d.vetContacted,
          vetAdvice: d.vetAdvice,
          internalNotes: d.internalNotes,
          followUpDue: d.followUpDue,
          reportedBy: by,
        })
        .returning({ id: incidents.id });
      for (const s of stored) {
        const [doc] = await tx
          .insert(documents)
          .values({
            customerId: owner.dog.customerId,
            dogId: owner.dog.id,
            storageKey: s.key,
            displayName: safeDisplayName(s.p.fileName),
            contentType: s.mime,
            sizeBytes: s.p.bytes.byteLength,
            sha256: createHash('sha256').update(s.p.bytes).digest('hex'),
            uploadedBy: by ?? owner.customerUserId,
            purpose: 'incident',
          })
          .returning({ id: documents.id });
        await tx.insert(incidentPhotos).values({ incidentId: row!.id, documentId: doc!.id });
      }
      await recordAudit(tx, {
        actor,
        action: 'incident.reported',
        entityType: 'incident',
        entityId: row!.id,
        metadata: { kind: d.kind, severity: d.severity, photos: stored.length, vetContacted: d.vetContacted },
      });
      return row!.id;
    });
  } catch (err) {
    for (const s of stored) await storage.delete(s.key).catch(() => logger.error({}, 'orphaned incident photo'));
    throw err;
  }
  await sendSafely(
    incidentMessage(
      owner.email,
      firstNameOf(owner.name),
      { dogName: owner.dog.name, update: false },
      appUrl(`/account/incidents/${id}`),
    ),
  );
  await db.update(incidents).set({ customerNotifiedAt: new Date() }).where(eq(incidents.id, id));
  return id;
}

export const IncidentUpdateInput = z.object({
  body: requiredText('the update', 4000),
  // Shared unless the Owner unticks it; corrections to the report should normally be shared.
  private: checkbox,
  followUpDue: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isIsoDate(v), 'Enter a real date'),
});

export async function addIncidentUpdate(db: Db, actor: Actor, rawId: string, input: unknown) {
  assertAuthorized(actor, 'incidents.manage');
  const d = parseInput(IncidentUpdateInput, input);
  const id = idOrNotFound(rawId, 'Incident');
  const inc = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(incidents).where(eq(incidents.id, id)).for('update');
    if (!row) throw new NotFoundError('Incident');
    await tx.insert(incidentUpdates).values({
      incidentId: id,
      body: d.body,
      sharedWithCustomer: !d.private,
      createdBy: actor.kind === 'user' ? actor.userId : null,
    });
    await tx
      .update(incidents)
      .set({ followUpDue: d.followUpDue, version: row.version + 1 })
      .where(eq(incidents.id, id));
    await recordAudit(tx, {
      actor,
      action: 'incident.updated',
      entityType: 'incident',
      entityId: id,
      metadata: { shared: !d.private },
    });
    return row;
  });
  if (!d.private) {
    const owner = await dogWithOwner(db, inc.dogId);
    await sendSafely(
      incidentMessage(
        owner.email,
        firstNameOf(owner.name),
        { dogName: owner.dog.name, update: true },
        appUrl(`/account/incidents/${id}`),
      ),
    );
  }
}

export async function setIncidentStatus(db: Db, actor: Actor, rawId: string, close: boolean, now = new Date()) {
  assertAuthorized(actor, 'incidents.manage');
  const id = idOrNotFound(rawId, 'Incident');
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(incidents).where(eq(incidents.id, id)).for('update');
    if (!row) throw new NotFoundError('Incident');
    if ((row.status === 'closed') === close)
      throw new ConflictError(close ? 'This incident is already closed.' : 'This incident is already open.');
    await tx
      .update(incidents)
      .set(
        close
          ? {
              status: 'closed',
              closedAt: now,
              closedBy: actor.kind === 'user' ? actor.userId : null,
              version: row.version + 1,
            }
          : { status: 'open', closedAt: null, closedBy: null, version: row.version + 1 },
      )
      .where(eq(incidents.id, id));
    await recordAudit(tx, {
      actor,
      action: close ? 'incident.closed' : 'incident.reopened',
      entityType: 'incident',
      entityId: id,
    });
  });
}

export async function ownerIncidents(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'incidents.manage');
  const rows = await db
    .select({ inc: incidents, dogName: dogs.name, customerName: users.name })
    .from(incidents)
    .innerJoin(dogs, eq(dogs.id, incidents.dogId))
    .innerJoin(customers, eq(customers.id, incidents.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .orderBy(desc(incidents.occurredAt))
    .limit(200);
  const today = londonDate(now);
  return {
    open: rows.filter((r) => r.inc.status === 'open'),
    followUpsDue: rows.filter((r) => r.inc.status === 'open' && r.inc.followUpDue && r.inc.followUpDue <= today),
    closed: rows.filter((r) => r.inc.status === 'closed').slice(0, 50),
  };
}

async function incidentDetail(db: Db, id: string) {
  const [row] = await db
    .select({ inc: incidents, dogName: dogs.name, customerName: users.name, customerUserId: users.id })
    .from(incidents)
    .innerJoin(dogs, eq(dogs.id, incidents.dogId))
    .innerJoin(customers, eq(customers.id, incidents.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(incidents.id, id));
  if (!row) throw new NotFoundError('Incident');
  const [updates, photos] = await Promise.all([
    db.select().from(incidentUpdates).where(eq(incidentUpdates.incidentId, id)).orderBy(asc(incidentUpdates.createdAt)),
    db
      .select({ id: documents.id, name: documents.displayName, contentType: documents.contentType })
      .from(incidentPhotos)
      .innerJoin(documents, eq(documents.id, incidentPhotos.documentId))
      .where(eq(incidentPhotos.incidentId, id)),
  ]);
  return { ...row, updates, photos };
}

export async function ownerIncident(db: Db, actor: Actor, rawId: string) {
  assertAuthorized(actor, 'incidents.manage');
  return incidentDetail(db, idOrNotFound(rawId, 'Incident'));
}

/** What the customer sees: the report and shared updates – never the Owner's internal notes. */
function forCustomer(d: Awaited<ReturnType<typeof incidentDetail>>) {
  const inc = { ...d.inc, internalNotes: null };
  return { ...d, inc, updates: d.updates.filter((u) => u.sharedWithCustomer) };
}

export async function myIncidents(db: Db, actor: Actor, opts: { dogId?: string } = {}) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'incidents.self.read', { ownerUserId: customer.userId });
  return db
    .select({
      id: incidents.id,
      dogId: incidents.dogId,
      dogName: dogs.name,
      occurredAt: incidents.occurredAt,
      kind: incidents.kind,
      severity: incidents.severity,
      acknowledgedAt: incidents.acknowledgedAt,
      status: incidents.status,
    })
    .from(incidents)
    .innerJoin(dogs, eq(dogs.id, incidents.dogId))
    .where(
      and(
        eq(incidents.customerId, customer.id),
        opts.dogId ? eq(incidents.dogId, idOrNotFound(opts.dogId, 'Dog')) : undefined,
      ),
    )
    .orderBy(desc(incidents.occurredAt));
}

export async function myIncident(db: Db, actor: Actor, rawId: string) {
  const me = asUser(actor);
  const d = await incidentDetail(db, idOrNotFound(rawId, 'Incident')).catch(() => null);
  if (!d || d.customerUserId !== me.userId) throw new NotFoundError('Incident');
  assertAuthorized(me, 'incidents.self.read', { ownerUserId: d.customerUserId });
  await recordAudit(db, { actor: me, action: 'incident.viewed', entityType: 'incident', entityId: d.inc.id });
  return forCustomer(d);
}

/** Customer confirms they've read the report (kept with the licence record). */
export async function acknowledgeIncident(db: Db, actor: Actor, rawId: string, now = new Date()) {
  const d = await myIncident(db, actor, rawId);
  if (d.inc.acknowledgedAt) return;
  await db.update(incidents).set({ acknowledgedAt: now }).where(eq(incidents.id, d.inc.id));
  await recordAudit(db, { actor, action: 'incident.acknowledged', entityType: 'incident', entityId: d.inc.id });
}

// ---- Daily welfare checks (D63) --------------------------------------------------------

export const WelfareCheckInput = z.object({
  dogId: z.string(),
  serviceDate: isoDate('the date'),
  bookingDogId: z.string().optional(),
  ate: z.enum(['all', 'some', 'none', 'not_fed'], { message: 'Choose how much they ate' }),
  drinking: z.enum(['normal', 'more', 'less'], { message: 'Choose how much they drank' }),
  toileting: z.enum(['normal', 'unusual'], { message: 'Choose normal or unusual' }),
  mood: z.enum(['happy', 'settled', 'unsettled'], { message: 'Choose their mood' }),
  concerns: z.array(z.string()).default([]),
  medicationGiven: optionalText(500),
  note: optionalText(2000),
  share: checkbox,
});

/**
 * Owner records a daily check. Private unless shared – but anything the licence says the owner
 * must be told about (drinking changes, stress, fear, aggression, anxiety, pain) is shared and the
 * customer emailed automatically.
 */
export async function recordWelfareCheck(db: Db, actor: Actor, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'welfare.manage');
  const d = parseInput(WelfareCheckInput, input);
  if (d.serviceDate > londonDate(now))
    throw new ValidationError('Please check the highlighted fields.', { serviceDate: 'This can’t be in the future' });
  const owner = await dogWithOwner(db, d.dogId);
  const { concerns, mustShare } = welfareConcerns(d.drinking, d.concerns);
  const shared = d.share || mustShare;
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(welfareChecks)
      .values({
        dogId: owner.dog.id,
        bookingDogId: d.bookingDogId ? idOrNotFound(d.bookingDogId, 'Booking') : null,
        serviceDate: d.serviceDate,
        ate: d.ate,
        drinking: d.drinking,
        toileting: d.toileting,
        mood: d.mood,
        concerns,
        medicationGiven: d.medicationGiven,
        note: d.note,
        shared,
        autoShared: mustShare,
        createdBy: actor.kind === 'user' ? actor.userId : null,
      })
      .returning({ id: welfareChecks.id });
    await recordAudit(tx, {
      actor,
      action: 'welfare.checked',
      entityType: 'welfare_check',
      entityId: row!.id,
      metadata: { concerns: concerns.length, shared, autoShared: mustShare },
    });
    return row!.id;
  });
  if (mustShare)
    await sendSafely(
      welfareNoteMessage(owner.email, firstNameOf(owner.name), owner.dog.name, appUrl(`/account/dogs/${owner.dog.id}`)),
    );
  return { id, shared, autoShared: mustShare, concerns };
}

export async function setWelfareShared(db: Db, actor: Actor, rawId: string, shared: boolean) {
  assertAuthorized(actor, 'welfare.manage');
  const id = idOrNotFound(rawId, 'Check');
  const [row] = await db.select().from(welfareChecks).where(eq(welfareChecks.id, id));
  if (!row) throw new NotFoundError('Check');
  if (row.autoShared && !shared)
    throw new ConflictError('This note records something the customer must be told about, so it stays shared.');
  await db.update(welfareChecks).set({ shared }).where(eq(welfareChecks.id, id));
  await recordAudit(db, {
    actor,
    action: shared ? 'welfare.shared' : 'welfare.unshared',
    entityType: 'welfare_check',
    entityId: id,
  });
}

export async function dogWelfare(db: Db, actor: Actor, rawDogId: string) {
  assertAuthorized(actor, 'welfare.manage');
  const dogId = idOrNotFound(rawDogId, 'Dog');
  const [checks, incs] = await Promise.all([
    db
      .select()
      .from(welfareChecks)
      .where(eq(welfareChecks.dogId, dogId))
      .orderBy(desc(welfareChecks.createdAt))
      .limit(60),
    db.select().from(incidents).where(eq(incidents.dogId, dogId)).orderBy(desc(incidents.occurredAt)).limit(50),
  ]);
  return { checks, incidents: incs };
}

/** Shared checks for a customer's own dog. */
export async function myDogWelfare(db: Db, actor: Actor, rawDogId: string) {
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'incidents.self.read', { ownerUserId: customer.userId });
  const dogId = idOrNotFound(rawDogId, 'Dog');
  return db
    .select({
      id: welfareChecks.id,
      serviceDate: welfareChecks.serviceDate,
      ate: welfareChecks.ate,
      drinking: welfareChecks.drinking,
      toileting: welfareChecks.toileting,
      mood: welfareChecks.mood,
      concerns: welfareChecks.concerns,
      medicationGiven: welfareChecks.medicationGiven,
      note: welfareChecks.note,
    })
    .from(welfareChecks)
    .innerJoin(dogs, eq(dogs.id, welfareChecks.dogId))
    .where(and(eq(welfareChecks.dogId, dogId), eq(dogs.customerId, customer.id), eq(welfareChecks.shared, true)))
    .orderBy(desc(welfareChecks.serviceDate), desc(welfareChecks.createdAt))
    .limit(60);
}

/** Owner dashboard counts. */
export async function welfareOverview(db: Db, actor: Actor, now = new Date()) {
  assertAuthorized(actor, 'incidents.manage');
  const today = londonDate(now);
  const open = await db
    .select({ id: incidents.id, followUpDue: incidents.followUpDue })
    .from(incidents)
    .where(eq(incidents.status, 'open'));
  return {
    open: open.length,
    followUpsDue: open.filter((o) => o.followUpDue && o.followUpDue <= today).length,
  };
}

/** Today's checks by booking, for the Owner's day view. */
export async function checksForDay(db: Db, actor: Actor, date: string) {
  assertAuthorized(actor, 'welfare.manage');
  if (!isIsoDate(date)) return new Map<string, number>();
  const rows = await db
    .select({ dogId: welfareChecks.dogId })
    .from(welfareChecks)
    .where(eq(welfareChecks.serviceDate, date));
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.dogId, (m.get(r.dogId) ?? 0) + 1);
  return m;
}
