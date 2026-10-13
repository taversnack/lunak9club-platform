import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import type { StorageProvider } from '@/infra/storage';
import { complianceRequirements, complianceSubmissions, customers, documents } from '@/infra/db/schema';
import { checkUpload, safeDisplayName } from '@/domain/documents/file-type';
import { addDays, isIsoDate, londonDate } from '@/domain/time';
import { authorize, hasPermission, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { NotFoundError, ValidationError } from '../errors';
import { idOrNotFound } from '../validation';
import { loadMyDog } from './dogs';
import { logger } from '@/infra/logger';
import { ownerReviewWaitingMessage } from '@/infra/email/templates';
import { appUrl, ownerEmails, sendSafely } from '../notify';

/** `administeredOn` is the date the vaccination was given (licence para 25(1)(h), D68). */
export type VaccinationEntry = { requirementKey: string; expiresOn: string; administeredOn: string };

export type UploadInput = {
  dogId: string;
  fileName: string;
  bytes: Uint8Array;
  entries: VaccinationEntry[];
  /** 'yes' if this record is the dog's first (primary) course of vaccinations (D74). */
  firstCourse: unknown;
  /** The date the first course finished; needed when firstCourse is 'yes'. */
  primaryCourseCompletedOn?: unknown;
};

/** D74: one plain question on upload, and the date the first course finished if the answer is yes. */
export const FirstCourseInput = z.object({
  firstCourse: z.enum(['yes', 'no'], { message: 'Tell us whether this is your dog’s first course of vaccinations' }),
  primaryCourseCompletedOn: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null),
});

/** Validates the first-course answer. Returns the completion date to store (or null) and any field errors. */
export function parseFirstCourse(
  input: Pick<UploadInput, 'firstCourse' | 'primaryCourseCompletedOn'>,
  today: string,
): { completedOn: string | null; fields: Record<string, string> } {
  const parsed = FirstCourseInput.safeParse({
    firstCourse: input.firstCourse,
    primaryCourseCompletedOn: typeof input.primaryCourseCompletedOn === 'string' ? input.primaryCourseCompletedOn : '',
  });
  if (!parsed.success) return { completedOn: null, fields: { firstCourse: parsed.error.issues[0]!.message } };
  const { firstCourse, primaryCourseCompletedOn: date } = parsed.data;
  if (firstCourse === 'no') return { completedOn: null, fields: {} };
  if (!date || !isIsoDate(date))
    return { completedOn: null, fields: { primaryCourseCompletedOn: 'Enter the date the first course finished' } };
  if (date > today)
    return {
      completedOn: null,
      fields: {
        primaryCourseCompletedOn: 'This date is in the future – upload the record once the course has finished',
      },
    };
  return { completedOn: date, fields: {} };
}

/**
 * Customer uploads a vaccination record covering one or more vaccinations.
 * The file is checked by content, stored under a random key, and each covered
 * vaccination gets a submission waiting for Owner review (replacing any earlier one still waiting).
 */
export async function uploadVaccinationRecord(
  db: Db,
  storage: StorageProvider,
  actor: Actor,
  input: UploadInput,
  now = new Date(),
) {
  const dog = await loadMyDog(db, actor, input.dogId, 'documents.self.upload');
  if (actor.kind !== 'user') throw new NotFoundError();

  const today = londonDate(now);
  const firstCourse = parseFirstCourse(input, today);
  const fields: Record<string, string> = { ...firstCourse.fields };
  const check = checkUpload(input.bytes);
  if (!check.ok) fields.file = check.message;
  if (!input.entries.length) fields.entries = 'Tick at least one vaccination this record shows';

  const vaccinationKeys = (
    await db
      .select({ key: complianceRequirements.key })
      .from(complianceRequirements)
      .where(and(eq(complianceRequirements.kind, 'vaccination'), eq(complianceRequirements.active, true)))
  ).map((r) => r.key);
  const seen = new Set<string>();
  for (const e of input.entries) {
    if (!vaccinationKeys.includes(e.requirementKey) || seen.has(e.requirementKey)) {
      fields.entries = 'Choose vaccinations from the list';
      continue;
    }
    seen.add(e.requirementKey);
    if (!isIsoDate(e.expiresOn))
      fields[`expiresOn.${e.requirementKey}`] = 'Enter the date the vaccination is valid until';
    else if (e.expiresOn < today)
      fields[`expiresOn.${e.requirementKey}`] = 'This date has already passed – the vaccination has expired';
    else if (e.expiresOn > addDays(today, 365 * 4))
      fields[`expiresOn.${e.requirementKey}`] = 'Check this date – it is more than 4 years away';
    const given = `administeredOn.${e.requirementKey}`;
    if (!isIsoDate(e.administeredOn ?? '')) fields[given] = 'Enter the date the vaccination was given';
    else if (e.administeredOn > today) fields[given] = 'This date is in the future';
    else if (dog.dateOfBirth && e.administeredOn < dog.dateOfBirth)
      fields[given] = 'This date is before your dog was born';
    else if (isIsoDate(e.expiresOn) && e.administeredOn > e.expiresOn)
      fields[given] = 'The date given must be before the valid-until date';
  }
  if (Object.keys(fields).length || !check.ok)
    throw new ValidationError('Please check the highlighted fields.', fields);

  const key = `customers/${dog.customerId}/dogs/${dog.id}/${randomUUID()}`;
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  await storage.put(key, input.bytes, check.type.mime);

  let documentId: string;
  try {
    documentId = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          customerId: dog.customerId,
          dogId: dog.id,
          storageKey: key,
          displayName: safeDisplayName(input.fileName),
          contentType: check.type.mime,
          sizeBytes: input.bytes.byteLength,
          sha256,
          uploadedBy: actor.userId,
        })
        .returning({ id: documents.id });
      const keys = input.entries.map((e) => e.requirementKey);
      // A newer upload replaces anything for the same vaccination still waiting for review.
      await tx
        .update(complianceSubmissions)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(complianceSubmissions.dogId, dog.id),
            inArray(complianceSubmissions.requirementKey, keys),
            eq(complianceSubmissions.status, 'pending_review'),
          ),
        );
      await tx.insert(complianceSubmissions).values(
        input.entries.map((e) => ({
          dogId: dog.id,
          requirementKey: e.requirementKey,
          documentId: doc!.id,
          expiresOn: e.expiresOn,
          administeredOn: e.administeredOn,
          primaryCourseCompletedOn: firstCourse.completedOn,
          submittedBy: actor.userId,
        })),
      );
      await recordAudit(tx, {
        actor,
        action: 'document.uploaded',
        entityType: 'document',
        entityId: doc!.id,
        metadata: { dogId: dog.id, vaccinations: keys.length, contentType: check.type.mime },
      });
      return doc!.id;
    });
  } catch (err) {
    // Don't leave orphaned files behind if the database write failed.
    await storage.delete(key).catch(() => logger.error({ err: 'cleanup failed' }, 'orphaned upload'));
    throw err;
  }
  for (const to of await ownerEmails(db)) await sendSafely(ownerReviewWaitingMessage(to, appUrl('/admin/reviews')));
  return documentId;
}

/**
 * Authorise and audit a document download. Owners may open any document; customers only their own.
 * Returns what's needed to stream it or redirect to a short-lived signed URL.
 */
export async function authoriseDocumentDownload(db: Db, actor: Actor, rawDocumentId: string) {
  const documentId = idOrNotFound(rawDocumentId, 'Document');
  const [row] = await db
    .select({ doc: documents, ownerUserId: customers.userId })
    .from(documents)
    .innerJoin(customers, eq(customers.id, documents.customerId))
    .where(eq(documents.id, documentId));
  if (!row) throw new NotFoundError('Document');

  const allowed = hasPermission(actor, 'documents.read_any')
    ? authorize(actor, 'documents.read_any').allowed
    : authorize(actor, 'documents.self.read', { ownerUserId: row.ownerUserId }).allowed;
  if (!allowed) {
    if (actor.kind === 'user') {
      await recordAudit(db, {
        actor,
        action: 'document.download_denied',
        entityType: 'document',
        entityId: documentId,
        outcome: 'denied',
      });
    }
    throw new NotFoundError('Document'); // same response as "doesn't exist"
  }
  await recordAudit(db, { actor, action: 'document.downloaded', entityType: 'document', entityId: documentId });
  return row.doc;
}
