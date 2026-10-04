import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import {
  CONSENT_KEYS,
  consentsAsked,
  consentUpdates,
  isUnderOneYear,
  registerGaps,
} from '@/domain/compliance/register';
import { onboardingInput, VetInput } from '@/server/services/dog-register-input';
import { sanitiseMetadata } from '@/server/audit';
import { REDACT_PATHS } from '@/infra/logger';

const today = '2026-10-04';
const valid = {
  fleaAndWorming: 'Spot-on',
  lastWormedOn: '2026-09-01',
  lastFleaTreatmentOn: '2026-09-15',
  exerciseRestricted: 'no',
  insured: 'yes',
  insurer: 'Petplan',
  temperament: 'Friendly',
  biteHistory: 'no',
  transport: 'yes',
  photosAndSocialMedia: 'no',
  emergencyVetTreatment: 'yes',
  feedingConsent: 'yes',
  feedingWithOthersConsent: 'no',
  cratingConsent: 'yes',
  parasiteTreatmentConsent: 'no',
  medicationConsent: 'yes',
  groupWalksConsent: 'yes',
  confirmAccurate: 'on',
};

describe('isUnderOneYear / consentsAsked', () => {
  it('is true only before the first birthday; unknown date of birth counts as not under 1', () => {
    expect(isUnderOneYear('2025-10-05', today)).toBe(true);
    expect(isUnderOneYear('2025-10-04', today)).toBe(false); // first birthday today
    expect(isUnderOneYear('2020-01-01', today)).toBe(false);
    expect(isUnderOneYear(null, today)).toBe(false);
  });
  it('asks the mixing question only for puppies', () => {
    expect(consentsAsked('2026-03-01', today)).toEqual(CONSENT_KEYS);
    expect(consentsAsked('2020-03-01', today)).not.toContain('mixingUnderOneConsent');
    expect(consentsAsked('2020-03-01', today)).toHaveLength(6);
  });
});

describe('consentUpdates', () => {
  const now = new Date('2026-10-04T10:00:00Z');
  it('sets value, when and who for new or changed answers only', () => {
    const out = consentUpdates(
      { feedingConsent: true, cratingConsent: false, groupWalksConsent: true },
      {
        feedingConsent: { value: true, at: new Date('2026-01-01'), by: 'u0' },
        cratingConsent: { value: true, at: new Date('2026-01-01'), by: 'u0' },
      },
      'u1',
      now,
    );
    expect(out).toEqual({
      cratingConsent: false,
      cratingConsentAt: now,
      cratingConsentBy: 'u1',
      groupWalksConsent: true,
      groupWalksConsentAt: now,
      groupWalksConsentBy: 'u1',
    });
  });
  it('leaves questions that were not asked untouched', () => {
    expect(consentUpdates({}, { mixingUnderOneConsent: { value: true, at: now, by: 'u0' } }, 'u1', now)).toEqual({});
  });
});

describe('registerGaps', () => {
  it('lists every missing field for a dog from before the register fields existed', () => {
    expect(
      registerGaps({ dateOfBirth: '2020-01-01', health: null, consents: null, hasAgreedVet: false }, today),
    ).toEqual([
      'lastWormedOn',
      'lastFleaTreatmentOn',
      'exerciseRestricted',
      'insured',
      'agreedVet',
      'feedingConsent',
      'feedingWithOthersConsent',
      'cratingConsent',
      'parasiteTreatmentConsent',
      'medicationConsent',
      'groupWalksConsent',
    ]);
  });
  it('counts "no" answers as recorded', () => {
    const consents = Object.fromEntries(CONSENT_KEYS.map((k) => [k, false]));
    const health = { lastWormedOn: today, lastFleaTreatmentOn: today, exerciseRestricted: false, insured: false };
    expect(registerGaps({ dateOfBirth: '2026-03-01', health, consents, hasAgreedVet: true }, today)).toEqual([]);
  });
});

describe('onboardingInput', () => {
  const adult = onboardingInput({ today, dateOfBirth: '2020-01-01' });
  const puppy = onboardingInput({ today, dateOfBirth: '2026-03-01' });
  const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
    r.success ? [] : r.error!.issues.map((i) => i.path.join('.'));

  it('accepts a complete form; "no" answers are allowed', () => {
    const r = adult.parse(valid);
    expect(r.parasiteTreatmentConsent).toBe(false);
    expect(r.mixingUnderOneConsent).toBeUndefined();
  });
  it('requires each consent to be answered', () => {
    for (const k of CONSENT_KEYS.filter((x) => x !== 'mixingUnderOneConsent'))
      expect(issues(adult.safeParse({ ...valid, [k]: undefined }))).toContain(k);
    expect(issues(puppy.safeParse(valid))).toContain('mixingUnderOneConsent');
    expect(puppy.parse({ ...valid, mixingUnderOneConsent: 'yes' }).mixingUnderOneConsent).toBe(true);
  });
  it('needs details when restricted, an insurer when insured, and real past dates', () => {
    expect(issues(adult.safeParse({ ...valid, exerciseRestricted: 'yes' }))).toContain('exerciseRestrictions');
    expect(issues(adult.safeParse({ ...valid, insurer: '' }))).toContain('insurer');
    expect(adult.parse({ ...valid, insured: 'no', insurer: '' }).insured).toBe(false);
    expect(issues(adult.safeParse({ ...valid, lastWormedOn: '2026-10-05' }))).toContain('lastWormedOn');
    expect(issues(adult.safeParse({ ...valid, lastFleaTreatmentOn: '2019-12-31' }))).toContain('lastFleaTreatmentOn');
    expect(issues(adult.safeParse({ ...valid, lastWormedOn: '2026-02-30' }))).toContain('lastWormedOn');
  });
});

describe('VetInput', () => {
  const base = { practiceName: 'Town Vets', phone: '01483 000000' };
  it('requires a choice, and the practice details when it is a different practice', () => {
    expect(VetInput.safeParse(base).success).toBe(false);
    expect(VetInput.parse({ ...base, agreedVet: 'same' }).agreed).toEqual({ kind: 'same' });
    const r = VetInput.safeParse({ ...base, agreedVet: 'other', agreedPhone: 'abc' });
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual(['agreedPracticeName', 'agreedPhone']);
    expect(
      VetInput.parse({ ...base, agreedVet: 'other', agreedPracticeName: 'Riverside', agreedPhone: '01483 111222' })
        .agreed,
    ).toEqual({ kind: 'other', practiceName: 'Riverside', phone: '01483111222', address: null });
  });
});

describe('privacy safety nets', () => {
  it('drops register keys from audit metadata', () => {
    expect(
      sanitiseMetadata({
        insurer: 'x',
        insurancePolicyNumber: 'x',
        exerciseRestrictions: 'x',
        lastWormedOn: 'x',
        fleaDate: 'x',
        feedingConsent: true,
        vetContacted: true,
        vaccinations: 3,
      }),
    ).toEqual({ vetContacted: true, vaccinations: 3 });
  });
  it('redacts register fields in logs', () => {
    let out = '';
    const stream = new Writable({
      write(chunk, _enc, cb) {
        out += String(chunk);
        cb();
      },
    });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[redacted]' } }, stream);
    log.info({ dog: { insurer: 'Petplan', insurancePolicyNumber: 'PP-1', exerciseRestrictions: 'Lead only' } }, 'x');
    expect(out).not.toMatch(/Petplan|PP-1|Lead only/);
    expect(out).toContain('[redacted]');
  });
});
