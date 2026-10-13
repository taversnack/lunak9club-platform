import { describe, expect, it } from 'vitest';
import { reminderDaysCopy } from '@/domain/compliance/reminder-copy';

describe('dashboard reminder copy (D75)', () => {
  it('lists the configured days, largest first, without duplicates', () => {
    expect(
      reminderDaysCopy([
        { active: true, reminderDays: [60, 30, 14, 7] },
        { active: true, reminderDays: [30, 14, 7] },
      ]),
    ).toBe('Customers are reminded automatically 60, 30, 14 and 7 days before.');
  });
  it('ignores inactive requirements and handles one or no days', () => {
    expect(
      reminderDaysCopy([
        { active: false, reminderDays: [90] },
        { active: true, reminderDays: [7] },
      ]),
    ).toBe('Customers are reminded automatically 7 days before.');
    expect(reminderDaysCopy([{ active: true, reminderDays: [] }])).toBe('No automatic reminders are set up.');
  });
});
