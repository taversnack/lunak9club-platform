import { describe, expect, it } from 'vitest';
import { daysLabel, holdLapsed, overviewTimeline, timelineState, type TimelineRow } from '@/domain/booking/overview';

const now = new Date('2026-11-01T12:00:00Z');
const ctx = { now, today: '2026-11-01', myUserId: 'me', freeCancelHours: 48, formatHold: (d: Date) => d.toISOString() };
const row = (o: Partial<TimelineRow>): TimelineRow => ({
  id: Math.random().toString(36),
  serviceDate: '2026-11-03',
  dogName: 'Biscuit',
  status: 'requested',
  offerExpiresAt: null,
  cancelledAt: null,
  endedReason: null,
  lateCancellation: false,
  updatedAt: now,
  ...o,
});
const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe('daysLabel (pay link names)', () => {
  it('names dog and date, unique per day', () => {
    const a = daysLabel([{ dogName: 'Biscuit', serviceDate: '2026-11-03' }]);
    const b = daysLabel([{ dogName: 'Biscuit', serviceDate: '2026-11-04' }]);
    expect(a).toBe('Biscuit, Tue 3 Nov');
    expect(a).not.toBe(b);
  });
  it('keeps several days short', () => {
    expect(
      daysLabel(['2026-11-03', '2026-11-04', '2026-11-05'].map((serviceDate) => ({ dogName: 'Rex', serviceDate }))),
    ).toBe('Rex, 3 days from Tue 3 Nov');
  });
});

describe('one lapse rule', () => {
  it('a past pay-by is lapsed', () => {
    expect(holdLapsed(ago(0.01), now)).toBe(true);
    expect(holdLapsed(new Date(now.getTime() + 60_000), now)).toBe(false);
    expect(holdLapsed(null, now)).toBe(false);
  });
  it('timeline shows a past pay-by as released, not "pay to secure"', () => {
    const s = timelineState(row({ status: 'pending_payment', offerExpiresAt: ago(0.01) }), ctx)!;
    expect(s.text).toBe('Released');
    expect(s.next).toMatch(/not paid in time/i);
  });
});

describe('ended days give a plain reason, never place counts', () => {
  const cases: [Partial<TimelineRow>, RegExp][] = [
    [
      { status: 'cancelled', endedReason: 'payment_expired', offerExpiresAt: ago(1), cancelledAt: ago(1) },
      /not paid in time/i,
    ],
    [{ status: 'cancelled', endedReason: 'request_closed', cancelledAt: ago(1) }, /no charge/i],
    [{ status: 'cancelled', endedReason: 'cancelled_by_customer', cancelledAt: ago(1) }, /you withdrew or cancelled/i],
    [
      { status: 'cancelled', endedReason: 'cancelled_by_customer', cancelledAt: ago(1), lateCancellation: true },
      /still charged/i,
    ],
    [{ status: 'cancelled', endedReason: 'cancelled_by_owner', cancelledAt: ago(1) }, /Luna/],
    [{ status: 'rejected', updatedAt: ago(1) }, /./],
  ];
  it.each(cases)('%o', (o, re) => {
    const s = timelineState(row(o), ctx)!;
    expect(s.ended).toBe(true);
    expect(s.next).toMatch(re);
    expect(`${s.text} ${s.next}`).not.toMatch(/\d+ (places?|spaces?) left|nearly full/i);
  });
});

describe('overviewTimeline', () => {
  it('always includes recent declined/lapsed items, drops old ones, keeps room for upcoming', () => {
    const upcoming = Array.from({ length: 10 }, (_, i) =>
      row({ serviceDate: `2026-11-${String(i + 3).padStart(2, '0')}` }),
    );
    const recent = row({ status: 'rejected', serviceDate: '2026-10-30', updatedAt: ago(2) });
    const old = row({ status: 'rejected', serviceDate: '2026-10-01', updatedAt: ago(20) });
    const out = overviewTimeline([...upcoming, recent, old], ctx);
    expect(out.map((r) => r.id)).toContain(recent.id);
    expect(out.map((r) => r.id)).not.toContain(old.id);
    expect(out.filter((r) => !r.state.ended).length).toBeGreaterThanOrEqual(3);
  });
});
