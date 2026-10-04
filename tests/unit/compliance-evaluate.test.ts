import { describe, expect, it } from 'vitest';
import { evaluateDogCompliance, type EvaluateInput, type RequirementDef } from '@/domain/compliance/evaluate';

const R = (key: string, kind: RequirementDef['kind'], extra: Partial<RequirementDef> = {}): RequirementDef => ({
  key,
  label: key,
  kind,
  mandatory: true,
  blocksBooking: true,
  reminderDays: [30, 14, 7],
  ...extra,
});

const requirements = [
  R('vaccination_core', 'vaccination'),
  R('vaccination_leptospirosis', 'vaccination'),
  R('vet_details', 'vet_details'),
  R('emergency_contact', 'emergency_contact'),
  R('onboarding_form', 'onboarding_form'),
  R('terms', 'terms'),
  R('meet_and_greet', 'assessment'),
  R('trial_day', 'assessment'),
];

const t0 = new Date('2026-09-01T10:00:00Z');
const approvedVacc = (key: string, expiresOn: string) => ({
  requirementKey: key,
  status: 'approved' as const,
  expiresOn,
  reviewReason: null,
  submittedAt: t0,
});

function complete(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    today: '2026-09-26',
    requirements,
    dog: { status: 'not_started', hasVet: true, onboardingSubmitted: true },
    hasEmergencyContact: true,
    acceptedCurrentTerms: true,
    submissions: [
      approvedVacc('vaccination_core', '2027-06-01'),
      approvedVacc('vaccination_leptospirosis', '2027-06-01'),
    ],
    assessments: [
      { kind: 'meet_and_greet', outcome: 'passed', recordedAt: t0 },
      { kind: 'trial_day', outcome: 'passed', recordedAt: t0 },
    ],
    ...overrides,
  };
}

const item = (e: ReturnType<typeof evaluateDogCompliance>, key: string) => e.items.find((i) => i.key === key)!;

describe('evaluateDogCompliance', () => {
  it('a brand-new dog is not started and cannot book', () => {
    const e = evaluateDogCompliance({
      today: '2026-09-26',
      requirements,
      dog: { status: 'not_started', hasVet: false, onboardingSubmitted: false },
      hasEmergencyContact: false,
      acceptedCurrentTerms: false,
      submissions: [],
      assessments: [],
    });
    expect(e.overall).toBe('not_started');
    expect(e.canBook).toBe(false);
    expect(e.allMandatoryMet).toBe(false);
    expect(item(e, 'vaccination_core').state).toBe('to_do');
    expect(item(e, 'meet_and_greet').state).toBe('waiting_for_us');
  });

  it('everything met but not yet approved by the Owner is ready for approval, still not bookable', () => {
    const e = evaluateDogCompliance(complete());
    expect(e.allMandatoryMet).toBe(true);
    expect(e.overall).toBe('ready_for_approval');
    expect(e.canBook).toBe(false);
    expect(e.bookingBlockers[0]).toMatch(/approved by Luna’s K9 Club/);
  });

  it('approved with everything valid can book', () => {
    const e = evaluateDogCompliance(complete({ dog: { status: 'approved', hasVet: true, onboardingSubmitted: true } }));
    expect(e.canBook).toBe(true);
    expect(e.overall).toBe('approved');
  });

  it('warns within 30 days of expiry but still allows booking', () => {
    const e = evaluateDogCompliance(
      complete({
        dog: { status: 'approved', hasVet: true, onboardingSubmitted: true },
        submissions: [
          approvedVacc('vaccination_core', '2026-10-26'),
          approvedVacc('vaccination_leptospirosis', '2027-06-01'),
        ],
      }),
    );
    expect(item(e, 'vaccination_core').state).toBe('expiring_soon');
    expect(e.canBook).toBe(true);
    expect(e.overall).toBe('expiring_soon');
  });

  it('31 days before expiry is not yet "expiring soon"', () => {
    const e = evaluateDogCompliance(
      complete({
        submissions: [
          approvedVacc('vaccination_core', '2026-10-27'),
          approvedVacc('vaccination_leptospirosis', '2027-06-01'),
        ],
      }),
    );
    expect(item(e, 'vaccination_core').state).toBe('met');
  });

  it('expiry date itself is still valid; the day after is expired and blocks booking', () => {
    const onDay = evaluateDogCompliance(
      complete({
        dog: { status: 'approved', hasVet: true, onboardingSubmitted: true },
        submissions: [
          approvedVacc('vaccination_core', '2026-09-26'),
          approvedVacc('vaccination_leptospirosis', '2027-06-01'),
        ],
      }),
    );
    expect(item(onDay, 'vaccination_core').state).toBe('expiring_soon');
    expect(onDay.canBook).toBe(true);

    const after = evaluateDogCompliance(
      complete({
        dog: { status: 'approved', hasVet: true, onboardingSubmitted: true },
        submissions: [
          approvedVacc('vaccination_core', '2026-09-25'),
          approvedVacc('vaccination_leptospirosis', '2027-06-01'),
        ],
      }),
    );
    expect(item(after, 'vaccination_core').state).toBe('expired');
    expect(after.canBook).toBe(false);
    expect(after.bookingBlockers).toContain('vaccination_core has expired.');
    expect(after.overall).toBe('action_needed');
  });

  it('an expired record with a renewal waiting shows as waiting for review', () => {
    const e = evaluateDogCompliance(
      complete({
        submissions: [
          approvedVacc('vaccination_core', '2026-09-01'),
          {
            requirementKey: 'vaccination_core',
            status: 'pending_review',
            expiresOn: '2027-09-01',
            reviewReason: null,
            submittedAt: new Date('2026-09-20'),
          },
          approvedVacc('vaccination_leptospirosis', '2027-06-01'),
        ],
      }),
    );
    expect(item(e, 'vaccination_core')).toMatchObject({ state: 'pending_review', renewalPending: true });
  });

  it('shows the Owner’s reason when a record is rejected', () => {
    const e = evaluateDogCompliance(
      complete({
        submissions: [
          {
            requirementKey: 'vaccination_core',
            status: 'rejected',
            expiresOn: '2027-01-01',
            reviewReason: 'The photo is blurry',
            submittedAt: t0,
          },
          approvedVacc('vaccination_leptospirosis', '2027-06-01'),
        ],
      }),
    );
    expect(item(e, 'vaccination_core')).toMatchObject({ state: 'rejected', action: 'The photo is blurry' });
    expect(e.overall).toBe('action_needed');
  });

  it('uses the latest assessment outcome', () => {
    const e = evaluateDogCompliance(
      complete({
        assessments: [
          { kind: 'meet_and_greet', outcome: 'rescheduled', recordedAt: new Date('2026-09-01') },
          { kind: 'meet_and_greet', outcome: 'passed', recordedAt: new Date('2026-09-10') },
          { kind: 'trial_day', outcome: 'not_passed', recordedAt: new Date('2026-09-12') },
        ],
      }),
    );
    expect(item(e, 'meet_and_greet').state).toBe('met');
    expect(item(e, 'trial_day').state).toBe('not_passed');
    expect(e.allMandatoryMet).toBe(false);
  });

  it('optional requirements never block', () => {
    const reqs = [...requirements.slice(0, 7), R('trial_day', 'assessment', { mandatory: false })];
    const e = evaluateDogCompliance(
      complete({
        requirements: reqs,
        assessments: [{ kind: 'meet_and_greet', outcome: 'passed', recordedAt: t0 }],
        dog: { status: 'approved', hasVet: true, onboardingSubmitted: true },
      }),
    );
    expect(e.canBook).toBe(true);
  });

  it('suspended dogs cannot book whatever their records say', () => {
    const e = evaluateDogCompliance(
      complete({ dog: { status: 'suspended', hasVet: true, onboardingSubmitted: true } }),
    );
    expect(e.canBook).toBe(false);
    expect(e.overall).toBe('suspended');
  });

  it('ignores superseded submissions', () => {
    const e = evaluateDogCompliance(
      complete({
        submissions: [
          {
            requirementKey: 'vaccination_core',
            status: 'superseded',
            expiresOn: '2020-01-01',
            reviewReason: null,
            submittedAt: t0,
          },
          approvedVacc('vaccination_core', '2027-06-01'),
          approvedVacc('vaccination_leptospirosis', '2027-06-01'),
        ],
      }),
    );
    expect(item(e, 'vaccination_core').state).toBe('met');
  });
});
