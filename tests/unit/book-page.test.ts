import { describe, expect, it } from 'vitest';
import { bookPageState, dogCantBookReasons, nothingToBookReasons } from '@/domain/booking/book-page';
import { trialDayCounts } from '@/domain/booking/rules';
import { trialAlreadyUsed } from '@/domain/booking/wording';

const dog = (canBook: boolean, canRequestTrial: boolean) => ({ canBook, canRequestTrial });

describe('Book page state', () => {
  it('asks the customer to add a dog when they have none', () => {
    expect(bookPageState([])).toBe('no-dogs');
  });
  it('shows the form (with the trial option) when the only dogs need a trial day (D85)', () => {
    expect(bookPageState([dog(false, true)])).toBe('form');
    expect(bookPageState([dog(false, true), dog(false, false)])).toBe('form');
  });
  it('shows the form when any dog can book', () => {
    expect(bookPageState([dog(true, false), dog(false, false)])).toBe('form');
  });
  it('says there is nothing to book when no dog can book or ask for a trial', () => {
    expect(bookPageState([dog(false, false)])).toBe('nothing-to-book');
  });
});

describe('Why a dog can’t be booked (Book page)', () => {
  // Existing compliance wording (src/domain/compliance/evaluate.ts), reused as is.
  const NOT_APPROVED = 'Your dog needs to be approved by Luna’s K9 Club before booking.';
  const PAUSED = 'Bookings for this dog are paused. Please contact us.';
  const EXPIRED = 'Core vaccination (DHP) has expired.';
  const blocked = (name: string, blockers: string[], extra: { trialUsed?: boolean } = {}) => ({
    name,
    canBook: false,
    canRequestTrial: false,
    blockers,
    ...extra,
  });

  it('an approved dog with an expired vaccination is told the vaccination has expired, not to get approved', () => {
    expect(dogCantBookReasons(blocked('Rex', [EXPIRED]))).toEqual([EXPIRED]);
  });
  it('a suspended dog is told bookings are paused, not to get approved', () => {
    expect(dogCantBookReasons(blocked('Bella', [PAUSED]))).toEqual([PAUSED]);
  });
  it('a dog that has had its one trial day says so (D95), then, as a separate line, what is still needed', () => {
    expect(dogCantBookReasons(blocked('Milo', [NOT_APPROVED], { trialUsed: true }))).toEqual([
      trialAlreadyUsed('Milo'),
      NOT_APPROVED,
    ]);
  });
  it('a dog that can be chosen has no reason', () => {
    expect(dogCantBookReasons({ name: 'Ok', canBook: true, canRequestTrial: false, blockers: [] })).toEqual([]);
    expect(dogCantBookReasons({ name: 'Ok', canBook: false, canRequestTrial: true, blockers: [NOT_APPROVED] })).toEqual(
      [],
    );
  });
  it('"Nothing to book yet" lists each dog with its own reason', () => {
    expect(nothingToBookReasons([blocked('Rex', [EXPIRED]), blocked('Bella', [PAUSED])])).toEqual([
      { name: 'Rex', reasons: [EXPIRED] },
      { name: 'Bella', reasons: [PAUSED] },
    ]);
  });
});

describe('One trial day per dog (D95)', () => {
  it('requested, approved and taken trial days count', () => {
    for (const s of ['requested', 'waitlisted', 'pending_payment', 'confirmed', 'attended', 'no_show'])
      expect(trialDayCounts(s)).toBe(true);
  });
  it('withdrawn or cancelled (cancelled) and declined (rejected) trial days don’t count', () => {
    expect(trialDayCounts('cancelled')).toBe(false);
    expect(trialDayCounts('rejected')).toBe(false);
  });
});
