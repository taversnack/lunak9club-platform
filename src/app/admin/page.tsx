import type { Metadata } from 'next';
import { auditActionLabel, auditEntityLabel } from '@/domain/audit-labels';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Grid, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { approveRequestAction, declineRequestAction } from './approvals/actions';
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
import { ownerApprovalList } from '@/server/services/approvals';
import { reminderDaysCopy } from '@/domain/compliance/reminder-copy';

export const metadata: Metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

const MAX_ROWS = 5;

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('admin.access');
  const db = getDb();
  const thisMonth = londonDate(new Date()).slice(0, 7);
  const [events, queue, today, billing, welfare, expiring, requests, approvalItems, requirements, unconfirmed] =
    await Promise.all([
      listRecentAuditEvents(db, actor, 20),
      reviewQueue(db, actor),
      ownerDay(db, actor, londonDate(new Date())),
      billingOverview(db, actor),
      welfareOverview(db, actor),
      expiringVaccinations(db, actor),
      ownerDataRequests(db, actor),
      ownerApprovalList(db, actor),
      listRequirements(db, actor),
      unconfirmedMembers(db, actor, thisMonth),
    ]);
  const waitingRequests = requests.filter((r) => r.r.status === 'requested').length;
  const approvals = approvalItems.length;
  const expiredCount = expiring.filter((v) => v.expired).length;
  const inboxTotal =
    approvals +
    queue.pending.length +
    expiring.length +
    billing.drafts +
    billing.refundRequests +
    billing.overdue +
    unconfirmed.length +
    welfare.followUpsDue +
    waitingRequests;
  const checkedIn = today.booked.filter((b) => b.status === 'attended').length;
  return (
    <Stack>
      <h1>Today</h1>
      {sp.approved ? <Alert tone="success">Request approved. The customer has been emailed.</Alert> : null}
      {sp.declined ? <Alert tone="info">Request declined. The customer has been emailed.</Alert> : null}
      <Card aria-labelledby="inbox">
        <h2 id="inbox">Needs you ({inboxTotal})</h2>
        {inboxTotal === 0 ? (
          <p>
            <StatusBadge tone="success">All clear</StatusBadge> Nothing is waiting for you.
          </p>
        ) : null}
        {approvals ? (
          <section aria-labelledby="in-requests">
            <h3 id="in-requests">Requests to approve ({approvals})</h3>
            <ul className={s.list}>
              {approvalItems.slice(0, MAX_ROWS).map((r) => (
                <li key={r.id} className={s.listItem} data-testid="today-approval">
                  <span>
                    <strong>{r.label}</strong> · {r.customerName}
                    <br />
                    {r.summary}
                    {r.lastError ? (
                      <>
                        <br />
                        <StatusBadge tone="warning">Couldn’t approve last time</StatusBadge>
                      </>
                    ) : null}
                  </span>
                  <span className={s.two}>
                    <ActionForm action={approveRequestAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="from" value="today" />
                      <SubmitButton>
                        Approve <span className="visually-hidden">{r.summary}</span>
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={declineRequestAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="from" value="today" />
                      <SubmitButton variant="secondary">
                        Decline <span className="visually-hidden">{r.summary}</span>
                      </SubmitButton>
                    </ActionForm>
                  </span>
                </li>
              ))}
            </ul>
            <p>
              <Link href="/admin/approvals">
                {approvals > MAX_ROWS ? `See all ${approvals} requests` : 'Add a note or see details'}
              </Link>
            </p>
          </section>
        ) : null}
        {expiring.length ? (
          <section aria-labelledby="in-vax">
            <h3 id="in-vax">
              Vaccinations ({expiring.length}
              {expiredCount ? `, ${expiredCount} expired` : ''})
            </h3>
            <ul className={s.list}>
              {[...expiring]
                .sort((a, b) => Number(b.expired) - Number(a.expired))
                .slice(0, MAX_ROWS)
                .map((v) => (
                  <li key={`${v.dogId}-${v.label}`} className={s.listItem}>
                    <Link href={`/admin/dogs/${v.dogId}`}>{v.dogName}</Link>
                    <span>
                      {v.label}:{' '}
                      {v.expired ? (
                        <StatusBadge tone="danger">Expired {formatUkDate(v.expiresOn)}</StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">Due {formatUkDate(v.expiresOn)}</StatusBadge>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}
        {queue.pending.length ? (
          <section aria-labelledby="in-records">
            <h3 id="in-records">Records to review ({queue.pending.length})</h3>
            <ul className={s.list}>
              {queue.pending.slice(0, MAX_ROWS).map((r) => (
                <li key={r.submissionId} className={s.listItem}>
                  <Link href={`/admin/dogs/${r.dogId}`}>{r.dogName}</Link>
                  <span>
                    {r.requirementLabel} · {r.customerName}
                  </span>
                </li>
              ))}
            </ul>
            <p>
              <Link href="/admin/reviews">Open reviews</Link>
            </p>
          </section>
        ) : null}
        {billing.drafts + billing.refundRequests + billing.overdue > 0 ? (
          <section aria-labelledby="in-money">
            <h3 id="in-money">Invoices and refunds</h3>
            <ul className={s.list}>
              {billing.drafts ? (
                <li className={s.listItem}>
                  <Link href="/admin/invoices">{billing.drafts} invoice drafts to check</Link>
                </li>
              ) : null}
              {billing.refundRequests ? (
                <li className={s.listItem}>
                  <Link href="/admin/refunds">{billing.refundRequests} refund requests</Link>
                </li>
              ) : null}
              {billing.overdue ? (
                <li className={s.listItem}>
                  <Link href="/admin/invoices">
                    <strong>{billing.overdue} overdue invoices</strong>
                  </Link>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
        {welfare.followUpsDue || waitingRequests || unconfirmed.length ? (
          <section aria-labelledby="in-other">
            <h3 id="in-other">Other</h3>
            <ul className={s.list}>
              {welfare.followUpsDue ? (
                <li className={s.listItem}>
                  <Link href="/admin/incidents">{welfare.followUpsDue} incident follow-ups due</Link>
                </li>
              ) : null}
              {waitingRequests ? (
                <li className={s.listItem}>
                  <Link href="/admin/data-requests">{waitingRequests} data requests</Link>
                </li>
              ) : null}
              {unconfirmed.length ? (
                <li className={s.listItem}>
                  <Link href="/admin/memberships">
                    {unconfirmed.length} customers haven’t confirmed membership days for {formatMonth(thisMonth)}
                  </Link>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </Card>
      <Grid>
        <Card aria-labelledby="approvals">
          <h2 id="approvals">Requests waiting</h2>
          <p className={s.bigNumber}>{approvals}</p>
          <Link href="/admin/approvals">Open requests</Link>
        </Card>
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
                    <td>{auditActionLabel(e.action)}</td>
                    <td>{auditEntityLabel(e.entityType)}</td>
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
