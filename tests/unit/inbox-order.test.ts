import { describe, expect, it } from 'vitest';
import { dueLabel, orderInbox, type InboxItem } from '@/domain/inbox';

const t = (iso: string) => new Date(iso);
const item = (key: string, kind: InboxItem['kind'], dueAt: string | null, createdAt = '2026-11-01T00:00:00Z') => ({
  key,
  kind,
  dueAt: dueAt ? t(dueAt) : null,
  createdAt: t(createdAt),
});

describe('orderInbox', () => {
  it('puts items with a deadline first, earliest first, then the rest oldest first', () => {
    const out = orderInbox([
      item('refund-new', 'refund_request', null, '2026-11-05T00:00:00Z'),
      item('later', 'approval', '2026-11-20T07:30:00Z'),
      item('refund-old', 'refund_request', null, '2026-11-01T00:00:00Z'),
      item('soon', 'pay_link_missing', '2026-11-02T10:00:00Z'),
    ]);
    expect(out.map((i) => i.key)).toEqual(['soon', 'later', 'refund-old', 'refund-new']);
  });

  it('breaks ties by kind, then key', () => {
    const due = '2026-11-02T07:30:00Z';
    const out = orderInbox([
      item('w', 'waitlist_place', due),
      item('a', 'approval', due),
      item('p', 'pay_link_missing', due),
    ]);
    expect(out.map((i) => i.key)).toEqual(['p', 'a', 'w']);
  });

  it('does not change the input array', () => {
    const input = [item('b', 'approval', null), item('a', 'approval', '2026-11-02T00:00:00Z')];
    orderInbox(input);
    expect(input.map((i) => i.key)).toEqual(['b', 'a']);
  });
});

describe('dueLabel', () => {
  const now = t('2026-11-02T12:00:00Z');
  it.each([
    [null, 'none'],
    ['2026-11-02T11:00:00Z', 'overdue'],
    ['2026-11-03T08:00:00Z', 'today'],
    ['2026-11-04T12:00:00Z', 'soon'],
    ['2026-11-20T12:00:00Z', 'later'],
  ])('%s is %s', (due, label) => {
    expect(dueLabel(due ? t(due) : null, now)).toBe(label);
  });
});
