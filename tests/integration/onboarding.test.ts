import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { FsStorageProvider } from '@/infra/storage/fs';
import { setEmailProvider } from '@/infra/email/providers';
import { complianceSubmissions, documents, dogs } from '@/infra/db/schema';
import { addMyContact, getMyCustomer, updateMyProfile } from '@/server/services/customers';
import { createMyDog, getMyDog, listMyDogs, saveMyDogVet, submitMyOnboardingForm } from '@/server/services/dogs';
import { authoriseDocumentDownload, uploadVaccinationRecord } from '@/server/services/documents';
import { acceptTerms, myTermsStatus, publishTerms } from '@/server/services/policies';
import {
  getDogForOwner,
  recordAssessment,
  reviewQueue,
  reviewSubmission,
  setDogStatus,
} from '@/server/services/owner-review';
import { ConflictError, NotFoundError, ValidationError } from '@/server/errors';
import { AuthorizationError } from '@/server/policy/authorize';
import { addDays, londonDate } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, PDF, PNG, validDog, validOnboarding, type TestUser } from '../support/factories';

const db = () => getDb();
const dir = mkdtempSync(join(tmpdir(), 'lunak9-docs-'));
const storage = new FsStorageProvider(dir);
const mail = new MemoryEmailProvider();
const today = londonDate(new Date());
const nextYear = addDays(today, 300);

let owner: TestUser;
let alice: TestUser;
let bob: TestUser;
let aliceDogId: string;

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Olivia Owner');
  alice = await makeUser(db(), 'customer', 'Alice Able');
  bob = await makeUser(db(), 'customer', 'Bob Baker');
});
afterAll(async () => {
  setEmailProvider(undefined);
  rmSync(dir, { recursive: true, force: true });
  await closeDb();
});

describe('customer onboarding journey', () => {
  it('saves a profile with UK formatting and validates bad input', async () => {
    await updateMyProfile(db(), alice, {
      phone: '07700 900123',
      addressLine1: '1 High St',
      town: 'Guildford',
      postcode: 'gu14ab',
    });
    const c = await getMyCustomer(db(), alice);
    expect(c).toMatchObject({ phone: '07700900123', postcode: 'GU1 4AB' });
    await expect(
      updateMyProfile(db(), alice, { phone: '123', addressLine1: '', town: 'x', postcode: 'nope' }),
    ).rejects.toMatchObject({
      fields: { phone: expect.any(String), addressLine1: expect.any(String), postcode: expect.any(String) },
    });
  });

  it('creates a dog, rejecting invalid details', async () => {
    await expect(createMyDog(db(), alice, { ...validDog, microchipNumber: 'abc', sex: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    aliceDogId = await createMyDog(db(), alice, validDog);
    const list = await listMyDogs(db(), alice);
    expect(list).toHaveLength(1);
    expect(list[0]!.evaluation.overall).toBe('not_started');
  });

  it('requires bite details when there is a bite history', async () => {
    await expect(
      submitMyOnboardingForm(db(), alice, aliceDogId, { ...validOnboarding, biteHistory: 'yes' }),
    ).rejects.toMatchObject({
      fields: { biteDetails: 'Please tell us what happened' },
    });
    await expect(
      submitMyOnboardingForm(db(), alice, aliceDogId, { ...validOnboarding, confirmAccurate: undefined }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('completes vet, contact, form and terms', async () => {
    await saveMyDogVet(db(), alice, aliceDogId, { practiceName: 'Town Vets', phone: '01483 000000' });
    await addMyContact(db(), alice, { name: 'Andy Able', phone: '07700900999', isEmergencyContact: 'on' });
    await submitMyOnboardingForm(db(), alice, aliceDogId, validOnboarding);
    const status = await myTermsStatus(db(), alice);
    expect(status.acceptedAt).toBeNull();
    await acceptTerms(db(), alice, status.terms!.id);
    await acceptTerms(db(), alice, status.terms!.id); // idempotent
    const { evaluation } = await getMyDog(db(), alice, aliceDogId);
    const byKey = Object.fromEntries(evaluation.items.map((i) => [i.key, i.state]));
    expect(byKey).toMatchObject({
      vet_details: 'met',
      emergency_contact: 'met',
      onboarding_form: 'met',
      terms: 'met',
      vaccination_core: 'to_do',
    });
  });

  it('checks uploads by content and dates', async () => {
    const bad = uploadVaccinationRecord(db(), storage, alice, {
      dogId: aliceDogId,
      fileName: 'evil.pdf',
      bytes: new TextEncoder().encode('<script>alert(1)</script>xxxxxxxx'),
      entries: [{ requirementKey: 'vaccination_core', expiresOn: nextYear }],
    });
    await expect(bad).rejects.toMatchObject({ fields: { file: expect.stringMatching(/PDF or a photo/) } });
    const expired = uploadVaccinationRecord(db(), storage, alice, {
      dogId: aliceDogId,
      fileName: 'card.pdf',
      bytes: PDF,
      entries: [{ requirementKey: 'vaccination_core', expiresOn: addDays(today, -1) }],
    });
    await expect(expired).rejects.toMatchObject({
      fields: { 'expiresOn.vaccination_core': expect.stringMatching(/expired/) },
    });
    const notVacc = uploadVaccinationRecord(db(), storage, alice, {
      dogId: aliceDogId,
      fileName: 'card.pdf',
      bytes: PDF,
      entries: [{ requirementKey: 'terms', expiresOn: nextYear }],
    });
    await expect(notVacc).rejects.toBeInstanceOf(ValidationError);
    expect((await db().select().from(documents).where(eq(documents.dogId, aliceDogId))).length).toBe(0); // nothing stored on failure
  });

  it('uploads one record covering all three vaccinations and notifies the Owner', async () => {
    await uploadVaccinationRecord(db(), storage, alice, {
      dogId: aliceDogId,
      fileName: 'vaccination card.pdf',
      bytes: PDF,
      entries: [
        { requirementKey: 'vaccination_core', expiresOn: nextYear },
        { requirementKey: 'vaccination_leptospirosis', expiresOn: nextYear },
        { requirementKey: 'vaccination_kennel_cough', expiresOn: nextYear },
      ],
    });
    const subs = await db().select().from(complianceSubmissions).where(eq(complianceSubmissions.dogId, aliceDogId));
    expect(subs.filter((s) => s.status === 'pending_review')).toHaveLength(3);
    expect(mail.lastTo(owner.email)?.template).toBe('owner.review-waiting');
    const q = await reviewQueue(db(), owner);
    expect(q.pending.filter((p) => p.dogId === aliceDogId)).toHaveLength(3);
  });

  it('a second upload replaces what is still waiting rather than duplicating', async () => {
    await uploadVaccinationRecord(db(), storage, alice, {
      dogId: aliceDogId,
      fileName: 'kennel cough.png',
      bytes: PNG,
      entries: [{ requirementKey: 'vaccination_kennel_cough', expiresOn: nextYear }],
    });
    const subs = await db().select().from(complianceSubmissions).where(eq(complianceSubmissions.dogId, aliceDogId));
    expect(
      subs.filter((s) => s.requirementKey === 'vaccination_kennel_cough' && s.status === 'pending_review'),
    ).toHaveLength(1);
    expect(subs.filter((s) => s.status === 'superseded')).toHaveLength(1);
  });
});

describe('Owner review', () => {
  it('rejects with a reason the customer sees, and emails without details', async () => {
    const [sub] = await db()
      .select()
      .from(complianceSubmissions)
      .where(
        sql`${complianceSubmissions.dogId} = ${aliceDogId} and ${complianceSubmissions.requirementKey} = 'vaccination_kennel_cough' and ${complianceSubmissions.status} = 'pending_review'`,
      );
    await expect(
      reviewSubmission(db(), owner, sub!.id, { decision: 'reject', expiresOn: nextYear, version: 1 }),
    ).rejects.toMatchObject({
      fields: { reason: expect.any(String) },
    });
    await reviewSubmission(db(), owner, sub!.id, {
      decision: 'request_replacement',
      reason: 'The date is cut off',
      expiresOn: nextYear,
      version: 1,
    });
    const { evaluation } = await getMyDog(db(), alice, aliceDogId);
    expect(evaluation.items.find((i) => i.key === 'vaccination_kennel_cough')).toMatchObject({
      state: 'replacement_requested',
      action: 'The date is cut off',
    });
    const email = mail.lastTo(alice.email)!;
    expect(email.template).toBe('compliance.needs-attention');
    expect(email.text).not.toContain('cut off');
    await expect(
      reviewSubmission(db(), owner, sub!.id, { decision: 'approve', expiresOn: nextYear, version: 2 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('approves records, using optimistic locking', async () => {
    const pending = await db()
      .select()
      .from(complianceSubmissions)
      .where(
        sql`${complianceSubmissions.dogId} = ${aliceDogId} and ${complianceSubmissions.status} = 'pending_review'`,
      );
    expect(pending).toHaveLength(2);
    await expect(
      reviewSubmission(db(), owner, pending[0]!.id, { decision: 'approve', expiresOn: nextYear, version: 7 }),
    ).rejects.toBeInstanceOf(ConflictError);
    for (const p of pending)
      await reviewSubmission(db(), owner, p.id, { decision: 'approve', expiresOn: nextYear, version: p.version });
    await uploadVaccinationRecord(db(), storage, alice, {
      dogId: aliceDogId,
      fileName: 'kc.pdf',
      bytes: PDF,
      entries: [{ requirementKey: 'vaccination_kennel_cough', expiresOn: nextYear }],
    });
    const [kc] = await db()
      .select()
      .from(complianceSubmissions)
      .where(
        sql`${complianceSubmissions.dogId} = ${aliceDogId} and ${complianceSubmissions.status} = 'pending_review'`,
      );
    await reviewSubmission(db(), owner, kc!.id, { decision: 'approve', expiresOn: nextYear, version: 1 });
  });

  it('will not approve the dog until assessments are passed', async () => {
    const [dog] = await db().select().from(dogs).where(eq(dogs.id, aliceDogId));
    await expect(
      setDogStatus(db(), owner, aliceDogId, { status: 'approved', version: dog!.version }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      recordAssessment(db(), owner, aliceDogId, {
        kind: 'trial_day',
        outcome: 'passed',
        assessedOn: addDays(today, 3),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await recordAssessment(db(), owner, aliceDogId, {
      kind: 'meet_and_greet',
      outcome: 'passed',
      assessedOn: today,
      internalNotes: 'Lovely, a bit shy with big dogs',
    });
    await recordAssessment(db(), owner, aliceDogId, { kind: 'trial_day', outcome: 'passed', assessedOn: today });
    const q = await reviewQueue(db(), owner);
    expect(q.ready.map((d) => d.id)).toContain(aliceDogId);
  });

  it('approves the dog, emails the customer and the customer can then book', async () => {
    const [dog] = await db().select().from(dogs).where(eq(dogs.id, aliceDogId));
    await setDogStatus(db(), owner, aliceDogId, { status: 'approved', version: dog!.version });
    const { evaluation } = await getMyDog(db(), alice, aliceDogId);
    expect(evaluation.canBook).toBe(true);
    expect(mail.lastTo(alice.email)?.template).toBe('compliance.dog-approved');
  });

  it('suspension needs a reason and blocks booking', async () => {
    const [dog] = await db().select().from(dogs).where(eq(dogs.id, aliceDogId));
    await expect(
      setDogStatus(db(), owner, aliceDogId, { status: 'suspended', version: dog!.version }),
    ).rejects.toBeInstanceOf(ValidationError);
    await setDogStatus(db(), owner, aliceDogId, {
      status: 'suspended',
      reason: 'Please call us',
      version: dog!.version,
    });
    expect((await getMyDog(db(), alice, aliceDogId)).evaluation.canBook).toBe(false);
    const [d2] = await db().select().from(dogs).where(eq(dogs.id, aliceDogId));
    await setDogStatus(db(), owner, aliceDogId, { status: 'approved', version: d2!.version });
  });

  it('a new terms version must be accepted again', async () => {
    await publishTerms(db(), owner, { title: 'Terms v2', body: 'Updated placeholder' });
    const { evaluation } = await getMyDog(db(), alice, aliceDogId);
    expect(evaluation.items.find((i) => i.key === 'terms')?.state).toBe('to_do');
    expect(evaluation.canBook).toBe(false);
    const s = await myTermsStatus(db(), alice);
    await acceptTerms(db(), alice, s.terms!.id);
    expect((await getMyDog(db(), alice, aliceDogId)).evaluation.canBook).toBe(true);
  });
});

describe('access control and privacy', () => {
  it('another customer cannot see, edit or upload for Alice’s dog', async () => {
    await expect(getMyDog(db(), bob, aliceDogId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitMyOnboardingForm(db(), bob, aliceDogId, validOnboarding)).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      saveMyDogVet(db(), bob, aliceDogId, { practiceName: 'X', phone: '01483000000' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      uploadVaccinationRecord(db(), storage, bob, {
        dogId: aliceDogId,
        fileName: 'x.pdf',
        bytes: PDF,
        entries: [{ requirementKey: 'vaccination_core', expiresOn: nextYear }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await listMyDogs(db(), bob)).toHaveLength(0);
  });

  it('another customer cannot download Alice’s document; the attempt is audited', async () => {
    const [doc] = await db().select().from(documents).where(eq(documents.dogId, aliceDogId)).limit(1);
    await expect(authoriseDocumentDownload(db(), bob, doc!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(authoriseDocumentDownload(db(), { kind: 'anonymous' }, doc!.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await authoriseDocumentDownload(db(), alice, doc!.id)).id).toBe(doc!.id);
    expect((await authoriseDocumentDownload(db(), owner, doc!.id)).id).toBe(doc!.id);
    const a = await db().execute<{ action: string; outcome: string }>(
      sql`select action, outcome from audit_events where entity_id = ${doc!.id} order by id`,
    );
    expect(a.rows.map((r) => `${r.action}:${r.outcome}`)).toEqual(
      expect.arrayContaining(['document.download_denied:denied', 'document.downloaded:success']),
    );
  });

  it('customers cannot use Owner services', async () => {
    await expect(getDogForOwner(db(), alice, aliceDogId)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(reviewQueue(db(), alice)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      recordAssessment(db(), alice, aliceDogId, { kind: 'trial_day', outcome: 'passed', assessedOn: today }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(publishTerms(db(), alice, { title: 'x', body: 'y' })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('customers never receive Owner-only assessment notes', async () => {
    const mine = await getMyDog(db(), alice, aliceDogId);
    expect(JSON.stringify(mine)).not.toContain('shy with big dogs');
    const ownerView = await getDogForOwner(db(), owner, aliceDogId);
    expect(JSON.stringify(ownerView.assessments)).toContain('shy with big dogs');
  });

  it('malformed ids behave like missing records', async () => {
    await expect(getMyDog(db(), alice, "1' or '1'='1")).rejects.toBeInstanceOf(NotFoundError);
    await expect(authoriseDocumentDownload(db(), owner, '../../etc/passwd')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('audit metadata for sensitive actions holds no personal details', async () => {
    const r = await db().execute<{ metadata: Record<string, unknown> }>(
      sql`select metadata from audit_events where action like 'dog.%' or action like 'document.%' or action like 'submission.%'`,
    );
    const text = JSON.stringify(r.rows);
    for (const s of ['Friendly', 'spot-on', 'Town Vets', '07700', 'Biscuit', 'cut off']) expect(text).not.toContain(s);
  });
});
