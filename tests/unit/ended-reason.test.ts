import { describe, expect, it } from 'vitest';
import { endedReason, HOLD_LAPSED_NOTE, noteKeepingLapseMarker } from '@/domain/booking/ended-reason';

const row = (o: Partial<Parameters<typeof endedReason>[0]> = {}) => ({
  status: 'cancelled',
  cancelledBy: null,
  internalNote: null,
  ...o,
});

describe('endedReason', () => {
  it('is null for days that have not ended', () => {
    for (const status of ['requested', 'pending_payment', 'confirmed', 'waitlisted', 'attended', 'no_show'])
      expect(endedReason(row({ status }), 'cust')).toBeNull();
  });
  it('tells a lapsed hold from a cancellation', () => {
    expect(endedReason(row({ internalNote: HOLD_LAPSED_NOTE }), 'cust')).toBe('payment_expired');
    expect(endedReason(row({ internalNote: `${HOLD_LAPSED_NOTE}\nrang her` }), 'cust')).toBe('payment_expired');
  });
  it('separates the customer, the Owner, a closed request, a system release and a decline', () => {
    expect(endedReason(row({ cancelledBy: 'cust' }), 'cust')).toBe('cancelled_by_customer');
    expect(endedReason(row({ cancelledBy: 'owner1' }), 'cust')).toBe('cancelled_by_owner');
    expect(endedReason(row(), 'cust')).toBe('request_closed');
    expect(endedReason(row({ internalNote: 'Card payment unavailable' }), 'cust')).toBe('released_by_system');
    expect(endedReason(row({ status: 'rejected' }), 'cust')).toBe('declined');
  });
  it('a cancellation by a person wins even if the note mentions the lapse', () => {
    expect(endedReason(row({ cancelledBy: 'cust', internalNote: HOLD_LAPSED_NOTE }), 'cust')).toBe(
      'cancelled_by_customer',
    );
  });
});

describe('noteKeepingLapseMarker', () => {
  const lapsed = row({ internalNote: HOLD_LAPSED_NOTE });
  it('keeps the marker when the note is edited or cleared', () => {
    expect(noteKeepingLapseMarker(lapsed, 'rang her')).toBe(`${HOLD_LAPSED_NOTE}\nrang her`);
    expect(noteKeepingLapseMarker(lapsed, null)).toBe(HOLD_LAPSED_NOTE);
    expect(noteKeepingLapseMarker(lapsed, `${HOLD_LAPSED_NOTE}\nrang her`)).toBe(`${HOLD_LAPSED_NOTE}\nrang her`);
  });
  it('leaves every other day exactly as typed', () => {
    expect(noteKeepingLapseMarker(row({ status: 'confirmed' }), 'x')).toBe('x');
    expect(noteKeepingLapseMarker(row({ cancelledBy: 'u', internalNote: HOLD_LAPSED_NOTE }), null)).toBeNull();
    expect(noteKeepingLapseMarker(row({ internalNote: 'something else' }), null)).toBeNull();
  });
});
