import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Grid, Muted, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { listRecentAuditEvents } from '@/server/queries/audit';
import { reviewQueue } from '@/server/services/owner-review';
import { ownerDay } from '@/server/services/owner-bookings';
import { getDb } from '@/infra/db/client';
import { formatDateTimeLondon } from '@/ui/format';
import { billingOverview } from '@/server/services/billing';
import { welfareOverview } from '@/server/services/welfare';
import { expiringVaccinations } from '@/server/services/reminders';
import { ownerDataRequests } from '@/server/services/privacy';
import { formatUkDate, londonDate } from '@/domain/time';
import { pounds } from '@/domain/pricing/engine';

export const metadata: Metadata = { title: 'Owner dashboard' };
export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const actor = await requirePermission('admin.access');
  const db = getDb();
  const [events, queue, today, billing, welfare, expiring, requests] = await Promise.all([
    listRecentAuditEvents(db, actor, 20),
    reviewQueue(db, actor),
    ownerDay(db, actor, londonDate(new Date())),
    billingOverview(db, actor),
    welfareOverview(db, actor),
    expiringVaccinations(db, actor),
    ownerDataRequests(db, actor),
  ]);
  const waitingRequests = requests.filter((r) => r.r.status === 'requested').length;
  const checkedIn = today.booked.filter((b) => b.status === 'attended').length;
  return (
    <Stack>
      <h1>Owner dashboard</h1>
      <Grid>
        <Card aria-labelledby="records">
          <h2 id="records">Records to review</h2>
          <p className={s.bigNumber}>{queue.pending.length}</p>
          <Link href="/admin/reviews">Open reviews</Link>
        </Card>
        <Card aria-labelledby="ready">
          <h2 id="ready">Dogs ready to approve</h2>
          <p className={s.bigNumber}>{queue.ready.length}</p>
          <Link href="/admin/reviews#ready">See dogs</Link>
        </Card>
        <Card aria-labelledby="assess">
          <h2 id="assess">Waiting for meet and greet or trial</h2>
          <p className={s.bigNumber}>{queue.awaitingAssessment.length}</p>
          <Link href="/admin/reviews#assessments">See dogs</Link>
        </Card>
      </Grid>
      <Grid>
        <Card aria-labelledby="today">
          <h2 id="today">Today</h2>
          {today.closedReason ? (
            <Muted>Closed – {today.closedReason}</Muted>
          ) : (
            <>
              <p className={s.bigNumber}>{today.booked.length} dogs</p>
              <p>
                {checkedIn} checked in · {today.taxi.length} taxi · {today.waitlist.length} waiting ·{' '}
                {Math.min(today.left.am, today.left.pm)} places left
              </p>
            </>
          )}
          <Link href="/admin/bookings">Open today</Link>
        </Card>
        <Card aria-labelledby="money">
          <h2 id="money">Invoices</h2>
          <p className={s.bigNumber}>{pounds(billing.duePence)} owed</p>
          <p>
            {billing.drafts} to check · {billing.scheduled} waiting to send · {billing.unpaid} unpaid ·{' '}
            <strong>{billing.overdue} overdue</strong> · {billing.refundRequests} refund requests
          </p>
          {billing.missingDetails.length ? (
            <p>
              <StatusBadge tone="warning">Business details missing</StatusBadge>{' '}
              <Link href="/admin/settings/business">Add them</Link>
            </p>
          ) : null}
          <Link href="/admin/invoices">Open invoices</Link>
        </Card>
      </Grid>
      <Grid>
        <Card aria-labelledby="incidents">
          <h2 id="incidents">Incidents</h2>
          <p className={s.bigNumber}>{welfare.open} open</p>
          <p>{welfare.followUpsDue} follow-ups due</p>
          <Link href="/admin/incidents">Open incidents</Link>
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
          <p className={s.hint}>Customers are reminded automatically 30, 14 and 7 days before.</p>
        </Card>
        {waitingRequests ? (
          <Card aria-labelledby="requests">
            <h2 id="requests">Data requests</h2>
            <p className={s.bigNumber}>{waitingRequests}</p>
            <Link href="/admin/data-requests">Review requests</Link>
          </Card>
        ) : null}
      </Grid>
      <Card aria-labelledby="audit">
        <h2 id="audit">Recent activity</h2>
        {events.length === 0 ? (
          <Muted>No activity yet.</Muted>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Recent activity table" tabIndex={0}>
            <table className={s.table}>
              <caption className="visually-hidden">Most recent audit events</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Record</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTimeLondon(e.occurredAt)}</td>
                    <td>{e.action}</td>
                    <td>{e.entityType}</td>
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
            </table>
          </div>
        )}
      </Card>
    </Stack>
  );
}
