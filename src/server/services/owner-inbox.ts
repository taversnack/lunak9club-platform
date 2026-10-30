import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { approvalRequests } from '@/infra/db/schema';
import { londonDate, londonInstant, addDays } from '@/domain/time';
import { dueLabel, orderInbox, type InboxItem } from '@/domain/inbox';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { ownerApprovalList } from './approvals';
import { monthEndDrafts, loadBusinessSettings, ownerRefundRequests } from './billing';
import { bookingsMissingPayLink } from './payments';
import { ownerDay } from './owner-bookings';

export type { InboxItem } from '@/domain/inbox';

const WAITLIST_LOOKAHEAD_DAYS = 14;

/** Send date of next month's invoices: the business's send day of the month before `month` (YYYY-MM). */
function draftSendInstant(month: string, sendDay: number, sendTime: string): Date {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return londonInstant(`${py}-${String(pm).padStart(2, '0')}-${String(sendDay).padStart(2, '0')}`, sendTime);
}

const isoDates = (payload: unknown): string[] => {
  const d = (payload as { dates?: unknown } | null)?.dates;
  return Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)) : [];
};

/**
 * Everything waiting on the Owner in one ordered list (D77). Read-only; Owner only. Titles carry no
 * medical, payment or contact detail. Due dates come only from existing rules: the first service date of
 * a booking request, the invoice send date, the pay-link hold expiry and the waitlisted day itself.
 * Refunds have no stated deadline, so they have `dueAt: null` and sort by age.
 */
export async function ownerInbox(
  db: Db,
  actor: Actor,
  opts: { limit?: number } = {},
  now = new Date(),
): Promise<InboxItem[]> {
  for (const p of ['approvals.manage', 'invoices.manage', 'refunds.manage', 'bookings.manage'] as const)
    assertAuthorized(actor, p);

  const [approvals, pending, drafts, refunds, missingPay, settings] = await Promise.all([
    ownerApprovalList(db, actor, { status: 'pending' }),
    db
      .select({ id: approvalRequests.id, payload: approvalRequests.payload })
      .from(approvalRequests)
      .where(eq(approvalRequests.status, 'pending')),
    monthEndDrafts(db, actor),
    ownerRefundRequests(db, actor),
    bookingsMissingPayLink(db, actor, {}, now),
    loadBusinessSettings(db),
  ]);

  const items: InboxItem[] = [];
  const add = (i: Omit<InboxItem, 'dueLabel'>) => items.push({ ...i, dueLabel: dueLabel(i.dueAt, now) });
  const today = londonDate(now);
  const datesById = new Map(pending.map((p) => [p.id, isoDates(p.payload)]));

  for (const a of approvals) {
    const first = (datesById.get(a.id) ?? []).filter((d) => d >= today).sort()[0];
    add({
      key: `approval:${a.id}`,
      kind: 'approval',
      title: a.label,
      customerName: a.customerName,
      dueAt: first ? londonInstant(first, '07:30') : null,
      createdAt: a.createdAt,
      ref: { type: 'approval', id: a.id },
    });
  }
  for (const d of [...drafts.ready, ...drafts.toCheck]) {
    add({
      key: `invoice_draft:${d.id}`,
      kind: 'invoice_draft',
      title: `Invoice draft for ${d.month}${d.reasons.length ? ' (needs checking)' : ''}`,
      customerName: d.customerName,
      dueAt: draftSendInstant(d.month, settings.sendDay, settings.sendTime),
      createdAt: new Date(0), // drafts carry no created date here; due date orders them
      ref: { type: 'invoice_draft', id: d.id },
    });
  }
  for (const r of refunds.open) {
    add({
      key: `refund_request:${r.r.id}`,
      kind: 'refund_request',
      title: 'Refund request to decide',
      customerName: r.customerName,
      dogName: r.dogName,
      dueAt: null,
      createdAt: r.r.createdAt,
      ref: { type: 'refund_request', id: r.r.id },
    });
  }
  for (const c of refunds.awaiting) {
    add({
      key: `refund_to_pay:${c.cn.id}`,
      kind: 'refund_to_pay',
      title: 'Credit to return to the customer',
      customerName: c.customerName,
      dueAt: null,
      createdAt: c.cn.createdAt,
      ref: { type: 'refund_to_pay', id: c.cn.id },
    });
  }
  for (const m of missingPay) {
    add({
      key: `pay_link_missing:${m.bookingId}`,
      kind: 'pay_link_missing',
      title: 'Pay link missing: resend it',
      customerName: m.customerName,
      dueAt: m.holdUntil,
      createdAt: m.holdUntil,
      ref: { type: 'pay_link_missing', id: m.bookingId },
    });
  }

  // Waitlist give-place prompts: waitlisted dogs on coming days that could be given a place right now.
  for (let i = 0; i < WAITLIST_LOOKAHEAD_DAYS; i++) {
    const date = addDays(today, i);
    const day = await ownerDay(db, actor, date, now);
    if (day.closedReason) continue;
    for (const w of day.waitlist) {
      if (w.giveBlock) continue;
      add({
        key: `waitlist_place:${w.id}`,
        kind: 'waitlist_place',
        title: 'A place is free for a dog on the waitlist',
        customerName: w.customerName,
        dogName: w.dogName,
        dueAt: londonInstant(date, '07:30'),
        createdAt: w.createdAt,
        ref: { type: 'waitlist_place', id: w.id, date },
      });
    }
  }

  const ordered = orderInbox(items);
  return opts.limit && opts.limit > 0 ? ordered.slice(0, opts.limit) : ordered;
}
