import 'server-only';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { complianceSubmissions, documents } from '@/infra/db/schema';
import { env } from '@/infra/env';
import { scanWithClamd, type ScanResult } from '@/infra/scan/clamd';
import type { StorageProvider } from '@/infra/storage/types';
import { ownerFileBlockedMessage } from '@/infra/email/templates';
import { logger } from '@/infra/logger';
import { recordAudit } from '../audit';
import type { Actor } from '../policy/authorize';
import { appUrl, ownerEmails, sendSafely } from '../notify';

/**
 * Virus scanning of uploads (D30). SCANNER_MODE=off (the default) changes nothing: uploads stay
 * "not_scanned". With clamav: a clean file is stored as clean; a scanner that is down or slow means
 * the file is accepted and HELD (not yet checked) and retried from the scheduler; an infected file
 * is refused (or, if found later, its bytes are deleted) and the Owner is told, with no file name,
 * customer or contents (rule 5).
 */

export type ScannerTarget = { host: string; port: number } | 'off';
let override: ScannerTarget | undefined;

/** Test seam: point the scanner at a fake clamd, or switch it off. */
export function setScannerOverride(target: ScannerTarget | undefined): void {
  override = target;
}

function target(): ScannerTarget {
  if (override) return override;
  const e = env();
  return e.SCANNER_MODE === 'clamav' ? { host: e.SCANNER_HOST, port: e.SCANNER_PORT } : 'off';
}

export type UploadVerdict =
  | { status: 'not_scanned'; scanAttempts: 0; scannedAt: null }
  | { status: 'clean' | 'held'; scanAttempts: 1; scannedAt: Date }
  | { status: 'infected' };

export type StorableVerdict = Exclude<UploadVerdict, { status: 'infected' }>;

/** Scan bytes about to be stored. Never throws: a scanner problem is a held file, not a failed upload. */
export async function scanUpload(bytes: Uint8Array, now: Date): Promise<UploadVerdict> {
  const t = target();
  if (t === 'off') return { status: 'not_scanned', scanAttempts: 0, scannedAt: null };
  const result = await scanWithClamd(bytes, { host: t.host, port: t.port });
  if (result === 'infected') return { status: 'infected' };
  return { status: result === 'clean' ? 'clean' : 'held', scanAttempts: 1, scannedAt: now };
}

export const BLOCKED_FILE_MESSAGE = 'We couldn’t accept that file. Please upload a new copy.';

/** Tell the Owner a file was blocked. Nothing identifying: just that it happened, and where to look. */
export async function alertFileBlocked(db: Db, actor: Actor, entityId: string | null): Promise<void> {
  await recordAudit(db, {
    actor,
    action: 'document.blocked_infected',
    entityType: 'document',
    entityId: entityId ?? undefined,
  });
  for (const to of await ownerEmails(db)) await sendSafely(ownerFileBlockedMessage(to, appUrl('/admin')));
}

const RETRY_AFTER_MINUTES = 5;
const BATCH = 20;

/**
 * Scheduler step: re-scan held documents. Each is claimed atomically (attempts and time bumped first),
 * so two overlapping ticks never scan the same file twice. A file found infected has its bytes deleted,
 * its waiting submissions sent back for a replacement, and the Owner told.
 */
export async function scanHeldDocuments(db: Db, storage: StorageProvider, actor: Actor, now = new Date()) {
  const t = target();
  if (t === 'off') return { checked: 0, clean: 0, infected: 0, stillHeld: 0, errors: 0 };
  const due = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.scanStatus, 'held'),
        or(
          isNull(documents.scannedAt),
          lt(documents.scannedAt, new Date(now.getTime() - RETRY_AFTER_MINUTES * 60_000)),
        ),
      ),
    )
    .orderBy(sql`${documents.scannedAt} asc nulls first`)
    .limit(BATCH);
  let clean = 0;
  let infected = 0;
  let stillHeld = 0;
  let errors = 0;
  for (const { id } of due) {
    const [claimed] = await db
      .update(documents)
      .set({ scanAttempts: sql`${documents.scanAttempts} + 1`, scannedAt: now })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.scanStatus, 'held'),
          or(
            isNull(documents.scannedAt),
            lt(documents.scannedAt, new Date(now.getTime() - RETRY_AFTER_MINUTES * 60_000)),
          ),
        ),
      )
      .returning({ id: documents.id, key: documents.storageKey });
    if (!claimed) continue; // another tick got it
    let result: ScanResult = 'unavailable';
    try {
      result = await scanWithClamd(await storage.get(claimed.key), { host: t.host, port: t.port });
    } catch {
      errors++;
      logger.warn({}, 'held document could not be read for scanning');
    }
    if (result === 'clean') {
      await db
        .update(documents)
        .set({ scanStatus: 'clean' })
        .where(and(eq(documents.id, id), eq(documents.scanStatus, 'held')));
      clean++;
    } else if (result === 'infected') {
      await db.transaction(async (tx) => {
        await tx.update(documents).set({ scanStatus: 'infected' }).where(eq(documents.id, id));
        await tx
          .update(complianceSubmissions)
          .set({ status: 'replacement_requested', reviewReason: BLOCKED_FILE_MESSAGE })
          .where(and(eq(complianceSubmissions.documentId, id), eq(complianceSubmissions.status, 'pending_review')));
      });
      await storage.delete(claimed.key).catch(() => logger.warn({}, 'infected file already gone'));
      await alertFileBlocked(db, actor, id);
      infected++;
    } else {
      stillHeld++;
    }
  }
  return { checked: due.length, clean, infected, stillHeld, errors };
}
