import { describe, expect, it } from 'vitest';
import {
  addYears,
  personalDataRetainUntil,
  retentionCutoffs,
  vaccinationReminderDue,
  welfareConcerns,
} from '@/domain/compliance/welfare';

describe('vaccination reminders (D11, D66)', () => {
  const T = [30, 14, 7];
  it('sends the nearest threshold reached, then “expired” once the date has passed', () => {
    expect(vaccinationReminderDue('2026-12-31', '2026-11-01', T)).toBeNull(); // 60 days left
    expect(vaccinationReminderDue('2026-12-31', '2026-12-01', T)).toBe(30);
    expect(vaccinationReminderDue('2026-12-31', '2026-12-21', T)).toBe(14); // 10 days left → 14, not 30 too
    expect(vaccinationReminderDue('2026-12-31', '2026-12-24', T)).toBe(7);
    expect(vaccinationReminderDue('2026-12-31', '2026-12-31', T)).toBe(7); // valid on its last day
    expect(vaccinationReminderDue('2026-12-31', '2027-01-01', T)).toBe('expired');
  });
});

describe('daily checks (D63)', () => {
  it('shares checks the licence says the owner must be told about', () => {
    expect(welfareConcerns('normal', [])).toEqual({ concerns: [], mustShare: false });
    expect(welfareConcerns('more', [])).toEqual({ concerns: ['drinking_more'], mustShare: true });
    expect(welfareConcerns('normal', ['anxiety', 'made_up'])).toEqual({ concerns: ['anxiety'], mustShare: true });
  });
});

describe('retention (D64)', () => {
  it('adds years safely, including leap days', () => {
    expect(addYears('2026-10-04', 3)).toBe('2029-10-04');
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
  });

  it('keeps personal details 3 years after the last visit (or joining)', () => {
    expect(personalDataRetainUntil('2026-10-01', '2025-01-01')).toBe('2029-10-01');
    expect(personalDataRetainUntil(null, '2026-03-15')).toBe('2029-03-15');
  });

  it('works out the cut-off dates', () => {
    expect(retentionCutoffs('2030-06-01')).toEqual({
      licence: '2027-06-01',
      financial: '2024-06-01',
      documents: '2027-06-01',
      technical: '2030-03-03',
    });
  });
});
