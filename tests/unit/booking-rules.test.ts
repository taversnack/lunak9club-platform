import { describe, expect, it } from 'vitest';
import {
  availabilityLabel,
  cancellationTerms,
  checkBookableDate,
  fits,
  isoWeekday,
  londonInstant,
  remainingFor,
  usage,
  vaccinationBlockForDate,
  type Settings,
} from '@/domain/booking/rules';

const settings: Settings = {
  sessionCapacity: 20,
  taxiCapacity: 20,
  openWeekdays: [1, 2, 3, 4, 5],
  fullDayStart: '07:30',
  fullDayEnd: '18:00',
  morningStart: '08:00',
  morningEnd: '12:00',
  afternoonStart: '12:00',
  afternoonEnd: '16:00',
  maxAdvanceDays: 90,
  freeCancellationHours: 48,
  waitlistOfferHours: 12,
};

describe('dates and times', () => {
  it('knows the weekday', () => {
    expect(isoWeekday('2026-09-28')).toBe(1); // Monday
    expect(isoWeekday('2026-10-04')).toBe(7); // Sunday
  });

  it('converts London wall-clock time in summer and winter', () => {
    expect(londonInstant('2026-09-28', '07:30').toISOString()).toBe('2026-09-28T06:30:00.000Z');
    expect(londonInstant('2026-11-02', '07:30').toISOString()).toBe('2026-11-02T07:30:00.000Z');
    // The Monday after the clocks go back (25 Oct 2026).
    expect(londonInstant('2026-10-26', '08:00').toISOString()).toBe('2026-10-26T08:00:00.000Z');
    // The Monday after the clocks go forward (29 Mar 2027).
    expect(londonInstant('2027-03-29', '08:00').toISOString()).toBe('2027-03-29T07:00:00.000Z');
  });

  it('closes bookings at 23:59 the day before', () => {
    expect(checkBookableDate({ date: '2026-09-28', today: '2026-09-27', settings })).toEqual({ ok: true });
    expect(checkBookableDate({ date: '2026-09-28', today: '2026-09-28', settings }).ok).toBe(false);
    expect(checkBookableDate({ date: '2026-09-25', today: '2026-09-28', settings }).ok).toBe(false);
  });

  it('refuses weekends, closures and dates beyond the booking window', () => {
    expect(checkBookableDate({ date: '2026-10-03', today: '2026-09-28', settings })).toMatchObject({
      ok: false,
      reason: 'We’re closed on this day.',
    });
    expect(
      checkBookableDate({ date: '2026-12-25', today: '2026-11-30', settings, closedReason: 'Christmas Day' }),
    ).toMatchObject({ ok: false, reason: 'Closed: Christmas Day' });
    expect(checkBookableDate({ date: '2026-12-28', today: '2026-09-28', settings })).toMatchObject({
      ok: false,
      reason: 'You can book up to 90 days ahead.',
    });
    expect(checkBookableDate({ date: '2026-12-25', today: '2026-09-27', settings }).ok).toBe(true); // exactly 89 days, not closed in this call
  });
});

describe('capacity', () => {
  const now = new Date('2026-09-27T10:00:00Z');
  it('a full day uses a morning and an afternoon place', () => {
    const u = usage(
      [
        { session: 'full', taxi: true, status: 'confirmed', offerExpiresAt: null },
        { session: 'am', taxi: false, status: 'confirmed', offerExpiresAt: null },
        { session: 'pm', taxi: true, status: 'attended', offerExpiresAt: null },
        { session: 'pm', taxi: false, status: 'cancelled', offerExpiresAt: null },
        { session: 'am', taxi: false, status: 'waitlisted', offerExpiresAt: null },
      ],
      now,
    );
    expect(u).toEqual({ am: 2, pm: 2, taxi: 2 });
  });

  it('live offers hold a place; lapsed offers don’t', () => {
    const live = usage(
      [{ session: 'full', taxi: false, status: 'offered', offerExpiresAt: new Date('2026-09-27T11:00:00Z') }],
      now,
    );
    const lapsed = usage(
      [{ session: 'full', taxi: false, status: 'offered', offerExpiresAt: new Date('2026-09-27T09:00:00Z') }],
      now,
    );
    expect(live.am).toBe(1);
    expect(lapsed.am).toBe(0);
  });

  it('checks the tightest session for full days, and taxi seats', () => {
    const cap = { session: 2, taxi: 1 };
    expect(remainingFor('full', { am: 1, pm: 2 }, cap)).toBe(0);
    expect(remainingFor('am', { am: 1, pm: 2 }, cap)).toBe(1);
    expect(fits('am', false, { am: 1, pm: 2, taxi: 0 }, cap)).toEqual({ ok: true });
    expect(fits('full', false, { am: 1, pm: 2, taxi: 0 }, cap)).toEqual({ ok: false, reason: 'session_full' });
    expect(fits('am', true, { am: 0, pm: 0, taxi: 1 }, cap)).toEqual({ ok: false, reason: 'taxi_full' });
  });

  it('labels availability without relying on colour', () => {
    expect(availabilityLabel(10, false)).toBe('available');
    expect(availabilityLabel(3, false)).toBe('nearly_full');
    expect(availabilityLabel(0, false)).toBe('full');
    expect(availabilityLabel(10, true)).toBe('closed');
  });
});

describe('cancellations', () => {
  it('is free at exactly 48 hours before the session and late one minute after', () => {
    // Full day 1 Oct 2026 starts 07:30 BST = 06:30Z; deadline 29 Sep 06:30Z.
    expect(cancellationTerms(new Date('2026-09-29T06:29:00Z'), '2026-10-01', 'full', settings).late).toBe(false);
    expect(cancellationTerms(new Date('2026-09-29T06:30:00Z'), '2026-10-01', 'full', settings).late).toBe(true);
  });
  it('uses the afternoon start for afternoon sessions', () => {
    expect(cancellationTerms(new Date('2026-09-29T10:59:00Z'), '2026-10-01', 'pm', settings).late).toBe(false);
  });
});

describe('vaccinations by date', () => {
  const v = [
    { label: 'Core vaccinations', expiresOn: '2026-10-15', mandatory: true, blocksBooking: true },
    { label: 'Kennel cough', expiresOn: '2027-01-01', mandatory: true, blocksBooking: true },
    { label: 'Optional thing', expiresOn: null, mandatory: false, blocksBooking: false },
  ];
  it('allows dates up to and including expiry, then blocks', () => {
    expect(vaccinationBlockForDate(v, '2026-10-15')).toBeNull();
    expect(vaccinationBlockForDate(v, '2026-10-16')).toBe('Core vaccinations runs out before this date.');
  });
});
