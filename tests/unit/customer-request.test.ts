import { describe, expect, it } from 'vitest';
import { customerBookingInput } from '../../src/domain/booking/customer-request';

describe('customerBookingInput (customer booking path)', () => {
  it('always asks for a full day, no separate taxi and the waitlist', () => {
    expect(customerBookingInput({ dogIds: ['d1'], dates: ['2026-11-17'], trial: false })).toEqual({
      dogIds: ['d1'],
      dates: ['2026-11-17'],
      session: 'full',
      taxi: false,
      ifFull: 'waitlist',
      trial: false,
    });
  });

  it('ignores half-day, taxi and skip values a customer sends anyway', () => {
    const tampered = {
      dogIds: ['d1'],
      dates: ['2026-11-17'],
      trial: true,
      customerNote: 'Hi',
      session: 'am',
      taxi: true,
      ifFull: 'skip',
    } as Parameters<typeof customerBookingInput>[0];
    expect(customerBookingInput(tampered)).toMatchObject({ session: 'full', taxi: false, ifFull: 'waitlist' });
    expect(customerBookingInput(tampered)).toMatchObject({ trial: true, customerNote: 'Hi' });
  });
});
