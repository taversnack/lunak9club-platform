import { describe, expect, it } from 'vitest';
import {
  allBlocks,
  isLicenceVaccination,
  primaryCourseClearOn,
  vaccinationBlocksForDate,
  type AttendanceVaccination,
} from '@/domain/compliance/attendance';
import { evaluateDogCompliance, type RequirementDef, type SubmissionFact } from '@/domain/compliance/evaluate';
import { vaccinationReminderDue } from '@/domain/compliance/welfare';
import { addDays } from '@/domain/time';

type State = AttendanceVaccination['state'];
const V = (key: string, state: State, expiresOn: string | null = '2027-06-30'): AttendanceVaccination => ({
  key,
  label:
    key === 'vaccination_core'
      ? 'Core vaccinations'
      : key === 'vaccination_leptospirosis'
        ? 'Leptospirosis'
        : 'Kennel cough',
  kind: 'vaccination',
  mandatory: true,
  blocksBooking: true,
  state,
  expiresOn,
});
const DATE = '2026-11-02';
const ok = [V('vaccination_core', 'met'), V('vaccination_leptospirosis', 'met'), V('vaccination_kennel_cough', 'met')];
const withOne = (v: AttendanceVaccination) => ok.map((x) => (x.key === v.key ? v : x));

describe('licence vaccinations are hard blocks (guidance 9.4, D73)', () => {
  it('knows which vaccinations the licence requires', () => {
    expect(isLicenceVaccination('vaccination_core')).toBe(true);
    expect(isLicenceVaccination('vaccination_leptospirosis')).toBe(true);
    expect(isLicenceVaccination('vaccination_kennel_cough')).toBe(false);
  });

  it('passes when everything is valid on the date', () => {
    expect(vaccinationBlocksForDate(ok, DATE, null)).toEqual({ hard: [], overridable: [] });
  });

  const states: [State, RegExp][] = [
    ['to_do', /missing/],
    ['pending_review', /waiting to be checked/],
    ['rejected', /wasn’t accepted/],
    ['replacement_requested', /new copy/],
    ['expired', /has expired/],
  ];
  for (const key of ['vaccination_core', 'vaccination_leptospirosis']) {
    for (const [state, msg] of states) {
      it(`${key} ${state} → hard block, never overridable`, () => {
        const b = vaccinationBlocksForDate(
          withOne(V(key, state, state === 'expired' ? '2026-10-01' : null)),
          DATE,
          null,
        );
        expect(b.hard).toHaveLength(1);
        expect(b.hard[0]).toMatch(msg);
        expect(b.overridable).toEqual([]);
      });
    }
    it(`${key} valid today but running out before the date → hard block`, () => {
      const b = vaccinationBlocksForDate(withOne(V(key, 'expiring_soon', addDays(DATE, -1))), DATE, null);
      expect(b.hard).toEqual([expect.stringMatching(/runs out before this date/)]);
      expect(vaccinationBlocksForDate(withOne(V(key, 'expiring_soon', DATE)), DATE, null).hard).toEqual([]);
    });
    it(`${key} stays a hard block even if the settings say it isn't mandatory`, () => {
      const loose = { ...V(key, 'expired', '2026-10-01'), mandatory: false, blocksBooking: false };
      expect(vaccinationBlocksForDate(withOne(loose), DATE, null).hard).toHaveLength(1);
    });
  }

  it('kennel cough problems are overridable, in every state', () => {
    for (const [state] of states) {
      const b = vaccinationBlocksForDate(withOne(V('vaccination_kennel_cough', state, null)), DATE, null);
      expect(b.hard).toEqual([]);
      expect(b.overridable).toHaveLength(1);
    }
  });

  it('kennel cough is ignored when the Owner makes it optional', () => {
    const optional = { ...V('vaccination_kennel_cough', 'expired', '2026-10-01'), mandatory: false };
    expect(vaccinationBlocksForDate(withOne(optional), DATE, null)).toEqual({ hard: [], overridable: [] });
  });

  it('allBlocks lists hard blocks first', () => {
    const b = vaccinationBlocksForDate(
      [V('vaccination_core', 'expired', '2026-10-01'), V('vaccination_kennel_cough', 'expired', '2026-10-01')],
      DATE,
      null,
    );
    expect(allBlocks(b)).toEqual([b.hard[0], b.overridable[0]]);
  });

  it('messages carry no dates or medical detail beyond the vaccination name', () => {
    const b = vaccinationBlocksForDate(withOne(V('vaccination_core', 'expired', '2026-10-01')), DATE, null);
    expect(b.hard[0]).not.toMatch(/2026|October/);
  });
});

describe('primary course: 14 days before attending (guidance 9.4, D74)', () => {
  const done = '2026-10-01';
  it('clears 14 days after the course finished', () => {
    expect(primaryCourseClearOn(done)).toBe('2026-10-15');
    expect(primaryCourseClearOn(null)).toBeNull();
  });
  it('day 13 is blocked, day 14 is allowed', () => {
    const day13 = vaccinationBlocksForDate(ok, addDays(done, 13), done);
    expect(day13.hard).toEqual([expect.stringMatching(/at least 14 days.*15 October 2026/)]);
    expect(day13.overridable).toEqual([]);
    expect(vaccinationBlocksForDate(ok, addDays(done, 14), done).hard).toEqual([]);
  });
  it('the day the course finished is blocked', () => {
    expect(vaccinationBlocksForDate(ok, done, done).hard).toHaveLength(1);
  });
  it('no date means no block', () => {
    expect(vaccinationBlocksForDate(ok, done, null).hard).toEqual([]);
  });
});

describe('evaluation feeds the rules', () => {
  const reqs: RequirementDef[] = [
    {
      key: 'vaccination_core',
      label: 'Core',
      kind: 'vaccination',
      mandatory: false,
      blocksBooking: false,
      reminderDays: [60, 30, 14, 7],
    },
    {
      key: 'vaccination_kennel_cough',
      label: 'KC',
      kind: 'vaccination',
      mandatory: true,
      blocksBooking: true,
      reminderDays: [60, 30, 14, 7],
    },
  ];
  const sub = (key: string, extra: Partial<SubmissionFact> = {}): SubmissionFact => ({
    requirementKey: key,
    status: 'approved',
    expiresOn: '2027-06-30',
    reviewReason: null,
    submittedAt: new Date('2026-09-01T10:00:00Z'),
    ...extra,
  });
  const run = (submissions: SubmissionFact[]) =>
    evaluateDogCompliance({
      today: '2026-10-04',
      requirements: reqs,
      dog: { status: 'approved', hasVet: true, onboardingSubmitted: true },
      hasEmergencyContact: true,
      acceptedCurrentTerms: true,
      submissions,
      assessments: [],
    });

  it('treats licence vaccinations as mandatory and blocking whatever the settings say', () => {
    const e = run([sub('vaccination_kennel_cough')]);
    expect(e.items.find((i) => i.key === 'vaccination_core')).toMatchObject({ mandatory: true, blocksBooking: true });
    expect(e.canBook).toBe(false);
  });

  it('takes the latest primary-course date from approved records only', () => {
    const e = run([
      sub('vaccination_core', { primaryCourseCompletedOn: '2026-09-20' }),
      sub('vaccination_kennel_cough', { primaryCourseCompletedOn: '2026-09-25' }),
      sub('vaccination_core', { status: 'pending_review', primaryCourseCompletedOn: '2026-10-01' }),
      sub('vaccination_core', { status: 'rejected', reviewReason: 'x', primaryCourseCompletedOn: '2026-10-02' }),
    ]);
    expect(e.primaryCourseCompletedOn).toBe('2026-09-25');
    expect(run([sub('vaccination_core'), sub('vaccination_kennel_cough')]).primaryCourseCompletedOn).toBeNull();
  });

  it('shows "expires soon" from the largest reminder threshold (60 days)', () => {
    const item = (expiresOn: string) =>
      run([sub('vaccination_core', { expiresOn }), sub('vaccination_kennel_cough')]).items.find(
        (i) => i.key === 'vaccination_core',
      )!.state;
    expect(item(addDays('2026-10-04', 60))).toBe('expiring_soon');
    expect(item(addDays('2026-10-04', 61))).toBe('met');
  });
});

describe('vaccination reminders at 60/30/14/7 (D66, D75)', () => {
  const T = [60, 30, 14, 7];
  const exp = '2026-12-31';
  it('sends the 60-day reminder 60 days ahead, not before', () => {
    expect(vaccinationReminderDue(exp, addDays(exp, -61), T)).toBeNull();
    expect(vaccinationReminderDue(exp, addDays(exp, -60), T)).toBe(60);
  });
  it('catches up with the nearest threshold only', () => {
    expect(vaccinationReminderDue(exp, addDays(exp, -45), T)).toBe(60); // first seen 45 days out → 60-day reminder
    expect(vaccinationReminderDue(exp, addDays(exp, -30), T)).toBe(30);
    expect(vaccinationReminderDue(exp, addDays(exp, -20), T)).toBe(30);
    expect(vaccinationReminderDue(exp, addDays(exp, -10), T)).toBe(14);
    expect(vaccinationReminderDue(exp, addDays(exp, -7), T)).toBe(7);
    expect(vaccinationReminderDue(exp, addDays(exp, 1), T)).toBe('expired');
  });
});
