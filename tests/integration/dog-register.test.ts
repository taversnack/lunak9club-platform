import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { FsStorageProvider } from '@/infra/storage/fs';
import { setEmailProvider } from '@/infra/email/providers';
import { complianceSubmissions, dogHealthProfiles, dogPermissions, dogs, vets } from '@/infra/db/schema';
import { getMyCustomer } from '@/server/services/customers';
import { createMyDog, getMyDog, saveMyDogVet, submitMyOnboardingForm } from '@/server/services/dogs';
import { uploadVaccinationRecord } from '@/server/services/documents';
import { getDogForOwner, reviewSubmission } from '@/server/services/owner-review';
import { emergencyCsv } from '@/server/services/owner-bookings';
import { anonymiseCustomer, exportMyData } from '@/server/services/privacy';
import { NotFoundError, ValidationError } from '@/server/errors';
import { addDays, londonDate } from '@/domain/time';
import { MemoryEmailProvider } from '../support/memory-email';
import { makeUser, PDF, validDog, validOnboarding, type TestUser } from '../support/factories';
import { approvedDog, readyCustomer } from '../support/onboard';

/** Licence dog register fields (D68–D72): treatment dates, insurance, exercise, consents, agreed vet. */

const db = () => getDb();
const dir = mkdtempSync(join(tmpdir(), 'lunak9-register-'));
const storage = new FsStorageProvider(dir);
const mail = new MemoryEmailProvider();
const today = londonDate(new Date());
const SENSITIVE = ['Petplan', 'PP-123456', 'Hydrotherapy only', 'Riverside Emergency', '01483111222'];

let owner: TestUser;
let carol: TestUser;
let dave: TestUser;
let dogId: string;

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Olivia Owner');
  carol = await makeUser(db(), 'customer', 'Carol Clark');
  dave = await makeUser(db(), 'customer', 'Dave Dunn');
  await readyCustomer(db(), carol);
  await readyCustomer(db(), dave);
  dogId = await createMyDog(db(), carol, { ...validDog, name: 'Pepper' });
  await saveMyDogVet(db(), carol, dogId, { practiceName: 'Town Vets', phone: '01483000000', agreedVet: 'same' });
});
afterAll(async () => {
  setEmailProvider(undefined);
  rmSync(dir, { recursive: true, force: true });
  await closeDb();
});

const perms = async (id: string) => (await db().select().from(dogPermissions).where(eq(dogPermissions.dogId, id)))[0]!;
const health = async (id: string) =>
  (await db().select().from(dogHealthProfiles).where(eq(dogHealthProfiles.dogId, id)))[0]!;
const dogRow = async (id: string) => (await db().select().from(dogs).where(eq(dogs.id, id)))[0]!;
const fieldsOf = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ValidationError);
  return (e as ValidationError).fields;
};

describe('onboarding form: register fields', () => {
  it('saves dates, exercise and insurance, and records who answered each consent and when', async () => {
    const t1 = new Date('2026-10-01T09:00:00Z');
    await submitMyOnboardingForm(
      db(),
      carol,
      dogId,
      { ...validOnboarding, exerciseRestricted: 'yes', exerciseRestrictions: 'Hydrotherapy only' },
      t1,
    );
    const h = await health(dogId);
    expect(h).toMatchObject({
      lastWormedOn: validOnboarding.lastWormedOn,
      lastFleaTreatmentOn: validOnboarding.lastFleaTreatmentOn,
      exerciseRestricted: true,
      exerciseRestrictions: 'Hydrotherapy only',
      insured: true,
      insurer: 'Petplan',
      insurancePolicyNumber: 'PP-123456',
    });
    const p = await perms(dogId);
    expect(p.feedingConsent).toBe(true);
    expect(p.feedingWithOthersConsent).toBe(false);
    expect(p.feedingConsentAt?.toISOString()).toBe(t1.toISOString());
    expect(p.feedingConsentBy).toBe(carol.userId);
    expect(p.feedingWithOthersConsentBy).toBe(carol.userId);
    // Pepper is an adult, so the under-1 question isn't asked or stored.
    expect(p.mixingUnderOneConsent).toBeNull();
    expect(p.mixingUnderOneConsentAt).toBeNull();
    expect(p.mixingUnderOneConsentBy).toBeNull();
  });

  it('keeps when/by if an answer is unchanged, and updates both only for answers that change', async () => {
    const before = await perms(dogId);
    const t2 = new Date('2026-10-02T09:00:00Z');
    await submitMyOnboardingForm(db(), carol, dogId, validOnboarding, t2);
    const same = await perms(dogId);
    expect(same.cratingConsentAt?.toISOString()).toBe(before.cratingConsentAt?.toISOString());

    const t3 = new Date('2026-10-03T09:00:00Z');
    await submitMyOnboardingForm(db(), carol, dogId, { ...validOnboarding, cratingConsent: 'no' }, t3);
    const changed = await perms(dogId);
    expect(changed.cratingConsent).toBe(false);
    expect(changed.cratingConsentAt?.toISOString()).toBe(t3.toISOString());
    expect(changed.cratingConsentBy).toBe(carol.userId);
    expect(changed.feedingConsentAt?.toISOString()).toBe(before.feedingConsentAt?.toISOString());
    // Not insured clears the insurer and policy; no restrictions clears the details.
    await submitMyOnboardingForm(db(), carol, dogId, { ...validOnboarding, insured: 'no' }, t3);
    expect(await health(dogId)).toMatchObject({
      insured: false,
      insurer: null,
      insurancePolicyNumber: null,
      exerciseRestricted: false,
      exerciseRestrictions: null,
    });
    await submitMyOnboardingForm(db(), carol, dogId, validOnboarding, t3);
  });

  it('requires every consent, details when restricted or insured, and past dates', async () => {
    const f = await fieldsOf(
      submitMyOnboardingForm(db(), carol, dogId, {
        ...validOnboarding,
        groupWalksConsent: undefined,
        exerciseRestricted: 'yes',
        insurer: '',
        lastWormedOn: addDays(today, 3),
        lastFleaTreatmentOn: '1999-01-01',
      }),
    );
    expect(f).toMatchObject({
      groupWalksConsent: expect.any(String),
      lastWormedOn: 'This date is in the future',
      lastFleaTreatmentOn: 'This date is before your dog was born',
    });
    const g = await fieldsOf(
      submitMyOnboardingForm(db(), carol, dogId, { ...validOnboarding, exerciseRestricted: 'yes', insurer: '' }),
    );
    expect(g).toMatchObject({ exerciseRestrictions: expect.any(String), insurer: expect.any(String) });
  });

  it('asks the under-1 mixing consent only for puppies', async () => {
    const pup = await createMyDog(db(), carol, { ...validDog, name: 'Nibs', dateOfBirth: addDays(today, -200) });
    const f = await fieldsOf(submitMyOnboardingForm(db(), carol, pup, validOnboarding));
    expect(f).toHaveProperty('mixingUnderOneConsent');
    await submitMyOnboardingForm(db(), carol, pup, { ...validOnboarding, mixingUnderOneConsent: 'no' });
    const p = await perms(pup);
    expect(p.mixingUnderOneConsent).toBe(false);
    expect(p.mixingUnderOneConsentBy).toBe(carol.userId);
    // An adult's answer is ignored even if sent.
    await submitMyOnboardingForm(db(), carol, dogId, { ...validOnboarding, mixingUnderOneConsent: 'yes' });
    expect((await perms(dogId)).mixingUnderOneConsent).toBeNull();
  });

  it('shows the Owner who answered each consent and when, without the ids', async () => {
    const view = await getDogForOwner(db(), owner, dogId);
    const feeding = view.consentAnswers.find((c) => c.key === 'feedingConsent')!;
    expect(feeding).toMatchObject({ value: true, byName: 'Carol Clark' });
    expect(feeding.at).toBeInstanceOf(Date);
    expect(JSON.stringify(view.consentAnswers)).not.toContain(carol.userId);
    expect(view.registerGaps).toEqual([]);
  });
});

describe('vaccination date given', () => {
  const entry = (over: Record<string, string> = {}) => ({
    requirementKey: 'vaccination_core',
    expiresOn: addDays(today, 300),
    administeredOn: addDays(today, -60),
    ...over,
  });
  const upload = (e: ReturnType<typeof entry>) =>
    uploadVaccinationRecord(db(), storage, carol, { dogId, fileName: 'v.pdf', bytes: PDF, entries: [e] });

  it('is required, not in the future and before the valid-until date', async () => {
    expect(await fieldsOf(upload(entry({ administeredOn: '' })))).toHaveProperty('administeredOn.vaccination_core');
    expect(
      (await fieldsOf(upload(entry({ administeredOn: addDays(today, 1) }))))['administeredOn.vaccination_core'],
    ).toBe('This date is in the future');
    await upload(entry());
    const [s] = await db()
      .select()
      .from(complianceSubmissions)
      .where(and(eq(complianceSubmissions.dogId, dogId), eq(complianceSubmissions.status, 'pending_review')));
    expect(s!.administeredOn).toBe(addDays(today, -60));
  });

  it('the Owner can correct it at review; blank keeps the customer’s date', async () => {
    const [s] = await db()
      .select()
      .from(complianceSubmissions)
      .where(and(eq(complianceSubmissions.dogId, dogId), eq(complianceSubmissions.status, 'pending_review')));
    await expect(
      reviewSubmission(db(), owner, s!.id, {
        decision: 'approve',
        expiresOn: s!.expiresOn,
        administeredOn: addDays(s!.expiresOn, 1),
        version: s!.version,
      }),
    ).rejects.toMatchObject({ fields: { administeredOn: expect.any(String) } });
    await reviewSubmission(db(), owner, s!.id, {
      decision: 'approve',
      expiresOn: s!.expiresOn,
      administeredOn: addDays(today, -45),
      version: s!.version,
    });
    const [after] = await db().select().from(complianceSubmissions).where(eq(complianceSubmissions.id, s!.id));
    expect(after!.administeredOn).toBe(addDays(today, -45));
    const r = await db().execute<{ metadata: Record<string, unknown> }>(
      sql`select metadata from audit_events where entity_id = ${s!.id}`,
    );
    expect(r.rows[0]!.metadata).toMatchObject({ dateGivenChanged: true });
    expect(JSON.stringify(r.rows)).not.toContain(addDays(today, -45));
  });
});

describe('agreed vet', () => {
  it('records the usual vet as agreed, and keeps the date when nothing changes', async () => {
    const d = await dogRow(dogId);
    expect(d.agreedVetId).toBe(d.vetId);
    expect(d.vetAgreedAt).toBeInstanceOf(Date);
    await saveMyDogVet(
      db(),
      carol,
      dogId,
      { practiceName: 'Town Vets', phone: '01483000000', vetName: 'Dr Lee', agreedVet: 'same' },
      new Date('2030-01-01T00:00:00Z'),
    );
    expect((await dogRow(dogId)).vetAgreedAt?.toISOString()).toBe(d.vetAgreedAt!.toISOString());
  });

  it('a different practice is stored separately; switching back removes it', async () => {
    const missing = await fieldsOf(
      saveMyDogVet(db(), carol, dogId, { practiceName: 'Town Vets', phone: '01483000000', agreedVet: 'other' }),
    );
    expect(missing).toMatchObject({ agreedPracticeName: expect.any(String), agreedPhone: expect.any(String) });
    const t = new Date('2026-10-03T10:00:00Z');
    await saveMyDogVet(
      db(),
      carol,
      dogId,
      {
        practiceName: 'Town Vets',
        phone: '01483000000',
        agreedVet: 'other',
        agreedPracticeName: 'Riverside Emergency',
        agreedPhone: '01483 111222',
      },
      t,
    );
    const d = await dogRow(dogId);
    expect(d.agreedVetId).not.toBe(d.vetId);
    expect(d.vetAgreedAt?.toISOString()).toBe(t.toISOString());
    const view = await getMyDog(db(), carol, dogId);
    expect(view.agreedVet).toMatchObject({ practiceName: 'Riverside Emergency', phone: '01483111222' });
    expect((await getDogForOwner(db(), owner, dogId)).agreedVet?.practiceName).toBe('Riverside Emergency');

    const separate = d.agreedVetId!;
    await saveMyDogVet(db(), carol, dogId, { practiceName: 'Town Vets', phone: '01483000000', agreedVet: 'same' });
    const back = await dogRow(dogId);
    expect(back.agreedVetId).toBe(back.vetId);
    expect(await db().select().from(vets).where(eq(vets.id, separate))).toHaveLength(0);
  });

  it('another customer cannot set the vet or answer consents for this dog', async () => {
    await expect(
      saveMyDogVet(db(), dave, dogId, { practiceName: 'X', phone: '01483000000', agreedVet: 'same' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(submitMyOnboardingForm(db(), dave, dogId, validOnboarding)).rejects.toBeInstanceOf(NotFoundError);
    expect((await perms(dogId)).feedingConsentBy).toBe(carol.userId);
  });
});

describe('existing dogs without the new fields (D72)', () => {
  it('can still book; the Owner sees what is missing and the customer gets a prompt', async () => {
    const legacy = await approvedDog(db(), owner, dave, 'Old Timer');
    // Simulate a dog onboarded before migration 0014.
    await db().execute(sql`update dog_health_profiles set last_wormed_on = null, last_flea_treatment_on = null,
      exercise_restricted = null, insured = null, insurer = null, insurance_policy_number = null where dog_id = ${legacy}`);
    await db().execute(sql`update dog_permissions set feeding_consent = null, feeding_consent_at = null,
      feeding_consent_by = null where dog_id = ${legacy}`);
    await db().execute(sql`update dogs set agreed_vet_id = null, vet_agreed_at = null where id = ${legacy}`);
    await db().execute(sql`update compliance_submissions set administered_on = null where dog_id = ${legacy}`);

    const mine = await getMyDog(db(), dave, legacy);
    expect(mine.evaluation.canBook).toBe(true);
    expect(mine.registerGaps).toEqual(
      expect.arrayContaining([
        'lastWormedOn',
        'lastFleaTreatmentOn',
        'exerciseRestricted',
        'insured',
        'agreedVet',
        'feedingConsent',
      ]),
    );
    expect(mine.registerGaps).not.toContain('mixingUnderOneConsent');
    const view = await getDogForOwner(db(), owner, legacy);
    expect(view.evaluation.canBook).toBe(true);
    expect(view.registerGaps).toContain('agreedVet');
    expect(view.consentAnswers.find((c) => c.key === 'feedingConsent')).toMatchObject({ value: null, byName: null });
    expect(view.submissions.every((s) => s.administeredOn === null)).toBe(true);
  });
});

describe('privacy', () => {
  it('keeps register values out of audit metadata and emails', async () => {
    const r = await db().execute<{ metadata: Record<string, unknown> }>(sql`select metadata from audit_events`);
    const audit = JSON.stringify(r.rows);
    const emails = JSON.stringify(mail.sent);
    for (const v of SENSITIVE) {
      expect(audit).not.toContain(v);
      expect(emails).not.toContain(v);
    }
  });

  it('the agreed vet appears on the Owner’s emergency list', async () => {
    const csv = await emergencyCsv(db(), owner, today);
    expect(csv.split('\r\n')[0]).toContain('Agreed emergency vet');
  });

  it('the customer’s data download includes the register fields and vaccination dates', async () => {
    const data = await exportMyData(db(), carol);
    const pepper = data.dogs.find((d) => d.id === dogId)!;
    expect(pepper.health).toMatchObject({ insurer: 'Petplan', lastWormedOn: validOnboarding.lastWormedOn });
    expect(pepper.permissions).toMatchObject({ feedingConsent: true });
    expect(pepper.vaccinations.some((v) => v.dateGiven === addDays(today, -45))).toBe(true);
  });

  it('anonymisation removes register fields, consents (with who answered) and the agreed vet', async () => {
    const customer = await getMyCustomer(db(), carol);
    await anonymiseCustomer(db(), storage, customer.id);
    const d = await dogRow(dogId);
    expect(d.agreedVetId).toBeNull();
    expect(d.vetAgreedAt).toBeNull();
    expect(await db().select().from(dogPermissions).where(eq(dogPermissions.dogId, dogId))).toHaveLength(0);
    expect(await db().select().from(dogHealthProfiles).where(eq(dogHealthProfiles.dogId, dogId))).toHaveLength(0);
    expect(await db().select().from(complianceSubmissions).where(eq(complianceSubmissions.dogId, dogId))).toHaveLength(
      0,
    );
    expect(await db().select().from(vets).where(eq(vets.customerId, customer.id))).toHaveLength(0);
    const left = await db().execute(
      sql`select count(*)::int as n from dog_permissions where ${sql.join(
        [
          'feeding_consent_by',
          'feeding_with_others_consent_by',
          'crating_consent_by',
          'parasite_treatment_consent_by',
          'medication_consent_by',
          'group_walks_consent_by',
          'mixing_under_one_consent_by',
        ].map((c) => sql`${sql.identifier(c)} = ${carol.userId}`),
        sql` or `,
      )}`,
    );
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
});

describe('database constraints', () => {
  it('rejects inconsistent register rows', async () => {
    const id = await approvedDog(db(), owner, dave, 'Constraint Dog');
    const bad = [
      sql`update dog_permissions set feeding_consent = true, feeding_consent_at = null where dog_id = ${id}`,
      sql`update dog_permissions set crating_consent = null, crating_consent_at = null, crating_consent_by = ${dave.userId} where dog_id = ${id}`,
      sql`update dog_health_profiles set insured = false, insurer = 'X' where dog_id = ${id}`,
      sql`update dog_health_profiles set insured = true, insurer = null where dog_id = ${id}`,
      sql`update dog_health_profiles set exercise_restricted = true, exercise_restrictions = null where dog_id = ${id}`,
      sql`update dogs set vet_agreed_at = null where id = ${id}`,
      sql`update compliance_submissions set administered_on = expires_on + 1 where dog_id = ${id}`,
    ];
    for (const q of bad) await expect(db().execute(q)).rejects.toThrow();
  });
});
