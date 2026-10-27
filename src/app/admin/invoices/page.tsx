import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Grid, Muted, Stack } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { InvoiceState } from '@/ui/invoice-state';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { billingOverview, monthEndDrafts, ownerInvoices, type InvoiceFilter } from '@/server/services/billing';
import { formatMonth } from '@/domain/billing/rules';
import { pounds } from '@/domain/pricing/engine';
import { formatUkDate } from '@/domain/time';
import { approveUnchangedDraftsAction, runBillingNowAction } from '../actions';

export const metadata: Metadata = { title: 'Invoices' };
export const dynamic = 'force-dynamic';

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: 'draft', label: 'To check' },
  { key: 'scheduled', label: 'Waiting to send' },
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid', label: 'Paid' },
  { key: 'all', label: 'All' },
];

export default async function OwnerInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('invoices.manage');
  const filter = (FILTERS.find((f) => f.key === sp.filter)?.key ?? 'draft') as InvoiceFilter;
  const db = getDb();
  const [overview, rows, monthEnd] = await Promise.all([
    billingOverview(db, actor),
    ownerInvoices(db, actor, filter),
    monthEndDrafts(db, actor),
  ]);
  const num = (v: string | undefined) => (v && /^\d{1,9}$/.test(v) ? Number(v) : 0);
  const exportMonths = [...overview.months].reverse();
  return (
    <Stack>
      <h1>Invoices</h1>
      {sp.ran ? (
        <Alert tone="success">
          Billing updated: {sp.drafts} drafts, {sp.sent} invoices sent, {sp.reminders} reminders sent.
        </Alert>
      ) : null}
      {sp.bulk ? (
        <Alert tone={num(sp.skipped) ? 'warning' : 'success'} title="Drafts approved">
          {num(sp.approved)} approved ({pounds(num(sp.total))}), {num(sp.sent)} emailed now and the rest wait for the
          send day.
          {num(sp.already) ? ` ${num(sp.already)} were already approved.` : ''}
          {num(sp.skipped)
            ? ` ${num(sp.skipped)} weren’t approved because they changed or need a check. They’re still drafts, listed below.`
            : ''}
        </Alert>
      ) : null}
      {overview.missingDetails.length ? (
        <Alert tone="warning" title="Add your business details before sending invoices">
          Missing: {overview.missingDetails.join(', ')}. <Link href="/admin/settings/business">Add them</Link>
        </Alert>
      ) : null}
      <Grid>
        <Card aria-labelledby="owed">
          <h2 id="owed">Owed to you</h2>
          <p className={s.bigNumber}>{pounds(overview.duePence)}</p>
          <p>
            {overview.unpaid} unpaid · <strong>{overview.overdue} overdue</strong>
          </p>
        </Card>
        <Card aria-labelledby="to-check">
          <h2 id="to-check">To check</h2>
          <p className={s.bigNumber}>{overview.drafts}</p>
          <p>
            {overview.scheduled} approved and waiting to send · {overview.refundRequests}{' '}
            <Link href="/admin/refunds">refund requests</Link>
          </p>
        </Card>
      </Grid>
      {monthEnd.ready.length || monthEnd.toCheck.length ? (
        <Card aria-labelledby="month-end">
          <h2 id="month-end">Approve drafts</h2>
          {monthEnd.ready.length ? (
            <ActionForm action={approveUnchangedDraftsAction}>
              <p>
                {monthEnd.ready.length} {monthEnd.ready.length === 1 ? 'draft hasn’t' : 'drafts haven’t'} changed since
                {monthEnd.ready.length === 1 ? ' it was' : ' they were'} made and{' '}
                {monthEnd.ready.length === 1 ? 'needs' : 'need'} nothing else. Each is checked again as it’s approved;
                any that changed in the meantime stay as drafts.
              </p>
              {monthEnd.ready.map((d) => (
                <input key={d.id} type="hidden" name="draft" value={`${d.id}:${d.version}:${d.totalPence}`} />
              ))}
              <div>
                <SubmitButton pendingText="Approving…" disabled={overview.missingDetails.length > 0}>
                  {`Approve all unchanged drafts (${monthEnd.ready.length}) – ${pounds(monthEnd.readyTotalPence)}`}
                </SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <Muted>No drafts can be approved together right now.</Muted>
          )}
          {monthEnd.toCheck.length ? (
            <>
              <h3>Check these first ({monthEnd.toCheck.length})</h3>
              <p>These aren’t included. Open each one, check it and approve it on its own.</p>
              <ul className={s.list}>
                {monthEnd.toCheck.map((d) => (
                  <li key={d.id}>
                    <Link href={`/admin/invoices/${d.id}`}>
                      {d.customerName}, {formatMonth(d.month)}
                    </Link>{' '}
                    ({pounds(d.totalPence)}): {d.reasons.join(' ')}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ) : null}
      <Card aria-labelledby="how">
        <h2 id="how">How membership billing works</h2>
        <p>
          Drafts for next month appear on day {overview.schedule.draftDay} and are kept up to date every night. Check
          each one and approve it. Approved invoices are emailed on day {overview.schedule.sendDay} at{' '}
          {overview.schedule.sendTime} and are due {overview.schedule.paymentTermsDays} days later. A reminder goes at{' '}
          {overview.schedule.reminderTime} on day {overview.schedule.reminderAfterDays} if it’s still unpaid. Joining
          (part-month) invoices are sent as soon as you approve them.
        </p>
        <ActionForm action={runBillingNowAction}>
          <div>
            <SubmitButton variant="secondary" pendingText="Updating…">
              Update drafts and send anything due now
            </SubmitButton>
          </div>
        </ActionForm>
      </Card>
      <nav aria-label="Invoice filters" className={s.subnav}>
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/invoices?filter=${f.key}`}
            aria-current={f.key === filter ? 'page' : undefined}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <Card aria-labelledby="list">
        <h2 id="list">{FILTERS.find((f) => f.key === filter)!.label}</h2>
        {rows.length === 0 ? (
          <Muted>No invoices here.</Muted>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Invoices" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Month</th>
                  <th scope="col">Number</th>
                  <th scope="col">Days</th>
                  <th scope="col">Total</th>
                  <th scope="col">Still owed</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.inv.id}>
                    <td>
                      <Link href={`/admin/invoices/${r.inv.id}`}>{r.customerName}</Link>
                    </td>
                    <td>{formatMonth(r.inv.periodMonth)}</td>
                    <td>{r.inv.number ?? '–'}</td>
                    <td>{r.lineCount}</td>
                    <td>{pounds(r.bal.totalPence)}</td>
                    <td>{r.inv.number ? pounds(r.bal.duePence) : '–'}</td>
                    <td>{r.inv.dueDate ? formatUkDate(r.inv.dueDate) : '–'}</td>
                    <td>
                      <InvoiceState state={r.state} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card aria-labelledby="export">
        <h2 id="export">Export for your accountant</h2>
        <ul className={s.list}>
          {exportMonths.map((m) => (
            <li key={m}>
              <a href={`/api/admin/exports/invoices?month=${m}`}>Invoices for {formatMonth(m)} (CSV)</a>
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
