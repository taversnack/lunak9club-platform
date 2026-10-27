import type { Metadata } from 'next';
import { auditActionLabel, auditEntityLabel } from '@/domain/audit-labels';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, DataTable, Muted, PageHeader, Stack, StatCard, StatusBadge } from '@/ui/components';
import t from '@/ui/today.module.css';
import { unconfirmedMembers } from '@/server/services/membership-workflow';
import { formatMonth } from '@/domain/billing/rules';
import { requirePermission } from '@/server/session';
import { listRecentAuditEvents } from '@/server/queries/audit';
import { listRequirements, reviewQueue } from '@/server/services/owner-review';
import { ownerDay } from '@/server/services/owner-bookings';
import { getDb } from '@/infra/db/client';
import { formatDateTimeLondon } from '@/ui/format';
import { billingOverview } from '@/server/services/billing';
import { welfareOverview } from '@/server/services/welfare';
import { expiringVaccinations } from '@/server/services/reminders';
import { ownerDataRequests } from '@/server/services/privacy';
import { formatUkDate, londonDate } from '@/domain/time';
import { pounds } from '@/domain/pricing/engine';
import { pendingApprovalCount } from '@/server/services/approvals';
import { reminderDaysCopy } from '@/domain/compliance/reminder-copy';

export const metadata: Metadata = { title: 'Owner dashboard' };
export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const actor = await requirePermission('admin.access');
  const db = getDb();
  const thisMonth = londonDate(new Date()).slice(0, 7);
  const [events, queue, today, billing, welfare, expiring, requests, approvals, requirements, unconfirmed] =
    await Promise.all([
      listRecentAuditEvents(db, actor, 20),
      reviewQueue(db, actor),
      ownerDay(db, actor, londonDate(new Date())),
      billingOverview(db, actor),
      welfareOverview(db, actor),
      expiringVaccinations(db, actor),
      ownerDataRequests(db, actor),
      pendingApprovalCount(db, actor),
      listRequirements(db, actor),
      unconfirmedMembers(db, actor, thisMonth),
    ]);
  const waitingRequests = requests.filter((r) => r.r.status === 'requested').length;
  const checkedIn = today.booked.filter((b) => b.status === 'attended').length;
  const places = Math.min(today.left.am, today.left.pm);
  const attention = [
    { key: 'records', n: queue.pending.length, text: 'Records to review', href: '/admin/reviews' as const },
    { key: 'ready', n: queue.ready.length, text: 'Dogs ready to approve', href: '/admin/reviews#ready' as const },
    {
      key: 'assess',
      n: queue.awaitingAssessment.length,
      text: 'Waiting for meet and greet or trial',
      href: '/admin/reviews#assessments' as const,
    },
    { key: 'data', n: waitingRequests, text: 'Data requests', href: '/admin/data-requests' as const },
  ];
  return (
    <Stack>
      <PageHeader title="Owner dashboard" lead={`Today · ${formatUkDate(londonDate(new Date()))}`} />
      <div className={t.kpis}>
        <StatCard
          label="Dogs in today"
          value={today.closedReason ? 'Closed' : today.booked.length}
          detail={
            today.closedReason
              ? today.closedReason
              : `${checkedIn} checked in · ${today.taxi.length} taxi · ${today.waitlist.length} waiting · ${places} places left`
          }
          href="/admin/bookings"
          linkText="Open today"
        />
        <StatCard label="Requests waiting" value={approvals} href="/admin/approvals" linkText="Open requests" />
        <StatCard
          label="Invoices owed"
          value={pounds(billing.duePence)}
          detail={
            <>
              {billing.drafts} to check · {billing.scheduled} waiting to send · {billing.unpaid} unpaid ·{' '}
              <strong>{billing.overdue} overdue</strong> · {billing.refundRequests} refund requests
            </>
          }
          href="/admin/invoices"
          linkText="Open invoices"
        />
        <StatCard
          label="Incidents open"
          value={welfare.open}
          detail={`${welfare.followUpsDue} follow-ups due`}
          href="/admin/incidents"
          linkText="Open incidents"
        />
      </div>
      {billing.missingDetails.length ? (
        <p>
          <StatusBadge tone="warning">Business details missing</StatusBadge>{' '}
          <Link href="/admin/settings/business">Add them</Link>
        </p>
      ) : null}
      <div className={t.split}>
        <Card aria-labelledby="attention">
          <div className={s.cardHead}>
            <h2 id="attention">Needs attention</h2>
          </div>
          <ul className={s.cardList}>
            {attention.map((a) => (
              <li key={a.key} className={t.attentionItem}>
                <span>
                  <strong>{a.n}</strong> {a.text}
                </span>
                <Link href={a.href}>
                  Open <span className="visually-hidden">{a.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-labelledby="expiring">
          <h2 id="expiring">Vaccinations expiring (30 days)</h2>
          {expiring.length === 0 ? (
            <Muted>None.</Muted>
          ) : (
            <ul className={s.list}>
              {expiring.slice(0, 8).map((v) => (
                <li key={`${v.dogId}-${v.label}`}>
                  <Link href={`/admin/dogs/${v.dogId}`}>{v.dogName}</Link> – {v.label}:{' '}
                  {v.expired ? <strong>expired {formatUkDate(v.expiresOn)}</strong> : formatUkDate(v.expiresOn)}
                </li>
              ))}
            </ul>
          )}
          <p className={s.hint}>{reminderDaysCopy(requirements)}</p>
        </Card>
        {unconfirmed.length ? (
          <Card aria-labelledby="unconfirmed">
            <h2 id="unconfirmed">Membership days not confirmed ({formatMonth(thisMonth)})</h2>
            <ul className={s.list}>
              {unconfirmed.map((u) => (
                <li key={u.customerId}>
                  <Link href={`/admin/customers/${u.customerId}#membership`}>{u.name}</Link>
                  {u.dogs.length ? ` (${u.dogs.join(', ')})` : ''}
                </li>
              ))}
            </ul>
            <p className={s.hint}>Their days are kept. You can confirm for them from their customer page.</p>
          </Card>
        ) : null}
      </div>
      <Card aria-labelledby="audit">
        <h2 id="audit">Recent activity</h2>
        {/* No full audit page exists yet, so show all 20 fetched events. */}
        {events.length > 0 && <Muted>Latest {events.length} events.</Muted>}
        {events.length === 0 ? (
          <Muted>No activity yet.</Muted>
        ) : (
          <DataTable caption="Most recent audit events" captionHidden stack>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">When</th>
                <th scope="col">Record</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td data-primary="">{auditActionLabel(e.action)}</td>
                  <td data-label="When">{formatDateTimeLondon(e.occurredAt)}</td>
                  <td data-label="Record">{auditEntityLabel(e.entityType)}</td>
                  <td>
                    <StatusBadge
                      tone={e.outcome === 'success' ? 'success' : e.outcome === 'denied' ? 'warning' : 'danger'}
                    >
                      {e.outcome === 'success' ? 'Success' : e.outcome === 'denied' ? 'Denied' : 'Failed'}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </Stack>
  );
}
