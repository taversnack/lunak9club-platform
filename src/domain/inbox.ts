/** Owner inbox (D77): one list for everything waiting on the Owner, most urgent first. Pure rules. */

export type InboxKind =
  'pay_link_missing' | 'approval' | 'refund_request' | 'refund_to_pay' | 'invoice_draft' | 'waitlist_place';

export type InboxDueLabel = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export type InboxItem = {
  /** Stable, e.g. `approval:<id>`. */
  key: string;
  kind: InboxKind;
  /** Short plain UK English. No medical, payment or contact detail (CLAUDE.md rule 5). */
  title: string;
  customerName: string;
  dogName?: string;
  /** The deadline that makes it urgent, from existing rules only. null: no deadline, ordered by age. */
  dueAt: Date | null;
  dueLabel: InboxDueLabel;
  /** When it joined the inbox, for ordering items without a deadline. */
  createdAt: Date;
  ref: { type: InboxKind; id: string; date?: string };
};

/** Tie-break between kinds when due dates match. */
const KIND_RANK: Record<InboxKind, number> = {
  pay_link_missing: 0,
  approval: 1,
  refund_request: 2,
  refund_to_pay: 3,
  invoice_draft: 4,
  waitlist_place: 5,
};

export function dueLabel(dueAt: Date | null, now: Date): InboxDueLabel {
  if (!dueAt) return 'none';
  const ms = dueAt.getTime() - now.getTime();
  if (ms < 0) return 'overdue';
  if (ms < 24 * 3_600_000) return 'today';
  if (ms < 3 * 24 * 3_600_000) return 'soon';
  return 'later';
}

/** Items with a deadline first (earliest, overdue first), then the rest oldest first; ties by kind. */
export function orderInbox<T extends Pick<InboxItem, 'kind' | 'dueAt' | 'createdAt' | 'key'>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.dueAt && b.dueAt) {
      const d = a.dueAt.getTime() - b.dueAt.getTime();
      if (d) return d;
    } else if (a.dueAt || b.dueAt) {
      return a.dueAt ? -1 : 1;
    } else {
      const d = a.createdAt.getTime() - b.createdAt.getTime();
      if (d) return d;
    }
    return KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.key.localeCompare(b.key);
  });
}
