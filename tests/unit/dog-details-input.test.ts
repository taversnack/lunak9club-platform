import { describe, expect, it } from 'vitest';
import { DogDetailsInput } from '@/server/services/dogs';
import { addDays, londonDate } from '@/domain/time';

const valid = {
  name: 'Biscuit',
  breed: 'Cockapoo',
  sex: 'female',
  dateOfBirth: '2021-04-01',
  weightKg: '12',
  microchipNumber: '826000000000123',
  neutered: 'yes',
};

describe('DogDetailsInput date of birth', () => {
  it('accepts a past date and today', () => {
    expect(DogDetailsInput.safeParse(valid).success).toBe(true);
    expect(DogDetailsInput.safeParse({ ...valid, dateOfBirth: londonDate(new Date()) }).success).toBe(true);
  });

  it('refuses a date in the future with a plain message', () => {
    const r = DogDetailsInput.safeParse({ ...valid, dateOfBirth: addDays(londonDate(new Date()), 1) });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('The date of birth can’t be in the future');
    expect(DogDetailsInput.safeParse({ ...valid, dateOfBirth: '2099-01-01' }).success).toBe(false);
  });
});
