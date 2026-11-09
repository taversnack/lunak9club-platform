import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { auditEvents, complianceSubmissions, documents } from '@/infra/db/schema';
import { FsStorageProvider } from '@/infra/storage/fs';
import { createMyDog, saveMyDogVet, submitMyOnboardingForm } from '@/server/services/dogs';
import { authoriseDocumentDownload, uploadVaccinationRecord } from '@/server/services/documents';
import { scanHeldDocuments, setScannerOverride, BLOCKED_FILE_MESSAGE } from '@/server/services/document-scan';
import { ValidationError } from '@/server/errors';
import { NotFoundError } from '@/server/errors';
import { AuthorizationError, type Actor } from '@/server/policy/authorize';
import { ownerInbox } from '@/server/services/owner-inbox';
import { addDays, londonDate } from '@/domain/time';
import { FAKE_VIRUS_MARKER, startFakeClamd } from '../support/fake-clamd';
import { MemoryEmailProvider } from '../support/memory-email';
import { readyCustomer } from '../support/onboard';
import { makeUser, PDF, validDog, validOnboarding, type TestUser } from '../support/factories';

const db = () => getDb();
const mail = new MemoryEmailProvider();
const storage = new FsStorageProvider(mkdtempSync(join(tmpdir(), 'lunak9-scan-')));
const system: Actor = { kind: 'system', job: 'test' };
const today = londonDate(new Date());

let owner: TestUser;
let uma: TestUser;
let dog: string;
const stops: (() => Promise<void>)[] = [];

const withMarker = new Uint8Array([...PDF, ...new TextEncoder().encode(FAKE_VIRUS_MARKER)]);
const upload = (bytes: Uint8Array, fileName = 'record.pdf') =>
  uploadVaccinationRecord(db(), storage, uma, {
    dogId: dog,
    fileName,
    bytes,
    firstCourse: 'no',
    entries: [
      { requirementKey: 'vaccination_core', expiresOn: addDays(today, 200), administeredOn: addDays(today, -30) },
    ],
  });
const row = async (id: string) => (await db().select().from(documents).where(eq(documents.id, id)))[0]!;

async function fake(mode: Parameters<typeof startFakeClamd>[0] = 'normal') {
  const f = await startFakeClamd(mode);
  stops.push(f.close);
  setScannerOverride({ host: '127.0.0.1', port: f.port });
  return f;
}
async function scannerDown() {
  const f = await startFakeClamd('normal');
  const port = f.port;
  await f.close();
  setScannerOverride({ host: '127.0.0.1', port });
}

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Olive Owner');
  uma = await makeUser(db(), 'customer', 'Uma Uploader');
  await readyCustomer(db(), uma);
  dog = await createMyDog(db(), uma, { ...validDog, name: 'Scanny' });
  await saveMyDogVet(db(), uma, dog, { practiceName: 'Vets', phone: '01483000000', agreedVet: 'same' });
  await submitMyOnboardingForm(db(), uma, dog, validOnboarding);
});
afterEach(async () => {
  setScannerOverride(undefined);
  while (stops.length) await stops.pop()!();
  mail.sent.length = 0;
});
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

describe('virus scanning of uploads (D30, fake scanner, no real malware)', () => {
  it('scanner off (the default): uploads are stored exactly as before, "not scanned"', async () => {
    setScannerOverride('off');
    const d = await row(await upload(PDF));
    expect(d).toMatchObject({ scanStatus: 'not_scanned', scanAttempts: 0, scannedAt: null });
  });

  it('a clean file is stored as clean', async () => {
    await fake();
    const d = await row(await upload(PDF));
    expect(d).toMatchObject({ scanStatus: 'clean', scanAttempts: 1 });
    expect(d.scannedAt).not.toBeNull();
  });

  it('an infected file is refused: nothing stored, the customer is told plainly, the Owner is told with no details', async () => {
    await fake();
    const before = (await db().select().from(documents)).length;
    const err = await upload(withMarker, 'secret-name.pdf').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields.file).toBe(BLOCKED_FILE_MESSAGE);
    expect((await db().select().from(documents)).length).toBe(before);
    const alert = mail.sent.find((m) => m.template === 'owner.file-blocked' && m.to === owner.email)!;
    expect(alert).toBeTruthy();
    for (const body of [alert.text, alert.html, alert.subject]) {
      expect(body).not.toMatch(/secret-name|Scanny|Uma|Uploader|FAKE-VIRUS|Signature/i);
    }
    const audit = await db().select().from(auditEvents).where(eq(auditEvents.action, 'document.blocked_infected'));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit)).not.toMatch(/secret-name|FAKE-VIRUS/);
  });

  it('scanner down: the file is accepted and held, only the Owner can open it', async () => {
    await scannerDown();
    const id = await upload(PDF);
    expect(await row(id)).toMatchObject({ scanStatus: 'held', scanAttempts: 1 });
    // The submission still goes to the Owner's review queue.
    const subs = await db().select().from(complianceSubmissions).where(eq(complianceSubmissions.documentId, id));
    expect(subs[0]!.status).toBe('pending_review');
    await expect(authoriseDocumentDownload(db(), uma, id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await authoriseDocumentDownload(db(), owner, id)).id).toBe(id);
  });

  it('the scheduler retries held files: clean once the scanner is back, and a second run does nothing', async () => {
    await scannerDown();
    const id = await upload(PDF);
    const later = new Date(Date.now() + 6 * 60_000);
    await fake();
    const first = await scanHeldDocuments(db(), storage, system, later);
    expect(first.clean).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({ scanStatus: 'clean', scanAttempts: 2 });
    const second = await scanHeldDocuments(db(), storage, system, later);
    expect(second.checked).toBe(0);
    expect((await row(id)).scanAttempts).toBe(2);
  });

  it('a held file shows on the Owner inbox (no file name), and leaves it once it is checked', async () => {
    await scannerDown();
    const id = await upload(PDF, 'secret-name.pdf');
    const items = await ownerInbox(db(), owner);
    const item = items.find((i) => i.key === `document_held:${id}`)!;
    expect(item).toMatchObject({
      kind: 'document_held',
      title: 'A file is waiting for a virus check',
      customerName: 'Uma Uploader',
      dogName: 'Scanny',
      dueAt: null,
      dueLabel: 'none',
      ref: { type: 'document_held', id, dogId: dog },
    });
    expect(JSON.stringify(item)).not.toMatch(/secret-name|record\.pdf/);
    await expect(ownerInbox(db(), uma)).rejects.toBeInstanceOf(AuthorizationError);
    await fake();
    await scanHeldDocuments(db(), storage, system, new Date(Date.now() + 6 * 60_000));
    expect((await ownerInbox(db(), owner)).some((i) => i.key === `document_held:${id}`)).toBe(false);
  });

  it('a held file is not retried again within five minutes, and stays held while the scanner is down', async () => {
    await scannerDown();
    const id = await upload(PDF);
    const soon = new Date(Date.now() + 60_000);
    expect((await scanHeldDocuments(db(), storage, system, soon)).checked).toBe(0);
    const later = new Date(Date.now() + 6 * 60_000);
    const r = await scanHeldDocuments(db(), storage, system, later);
    expect(r.stillHeld).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({ scanStatus: 'held', scanAttempts: 2 });
  });

  it('a held file found infected on retry is quarantined: bytes gone, submission sent back, Owner told', async () => {
    await scannerDown();
    const id = await upload(withMarker, 'secret-name.pdf');
    const d0 = await row(id);
    await fake();
    const later = new Date(Date.now() + 6 * 60_000);
    const r = await scanHeldDocuments(db(), storage, system, later);
    expect(r.infected).toBeGreaterThanOrEqual(1);
    expect((await row(id)).scanStatus).toBe('infected');
    await expect(storage.get(d0.storageKey)).rejects.toThrow();
    const [sub] = await db()
      .select()
      .from(complianceSubmissions)
      .where(and(eq(complianceSubmissions.documentId, id)));
    expect(sub).toMatchObject({ status: 'replacement_requested', reviewReason: BLOCKED_FILE_MESSAGE });
    const alert = mail.sent.find((m) => m.template === 'owner.file-blocked')!;
    expect(alert.text).not.toMatch(/secret-name|Scanny|Uma/i);
    // Nobody can open an infected file, not even the Owner.
    await expect(authoriseDocumentDownload(db(), owner, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('with the scanner off the retry step does nothing', async () => {
    setScannerOverride('off');
    expect(await scanHeldDocuments(db(), storage, system)).toEqual({
      checked: 0,
      clean: 0,
      infected: 0,
      stillHeld: 0,
      errors: 0,
    });
  });
});
