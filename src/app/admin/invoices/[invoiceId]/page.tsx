import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, FieldError, SubmitButton, TextField } from '@/ui/form';
import { InvoiceState } from '@/ui/invoice-state';
import { formatDateTimeLondon } from '@/ui/format';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerInvoice } from '@/server/services/billing';
import { formatMonth } from '@/domain/billing/rules';
import { pounds } from '@/domain/pricing/engine';
import { formatUkDate, londonDate } from '@/domain/time';
import {
  approveInvoiceAction,
  creditInvoiceAction,
  recordPaymentAction,
  resendInvoiceAction,
  unapproveInvoiceAction,
} from '../../actions';

export const metadata: Metadata = { title: 'Invoice' };
export const dynamic = 'force-dynamic';

const DONE: Record<string, string> = {
  sent: 'Approved and sent. The customer has been emailed.',
  scheduled: 'Approved. It will be sent automatically on the send day.',
  unapproved: 'Back to draft. It will be kept up to date until you approve it again.',
  payment: 'Payment recorded.',
  credited: 'Credit note issued.',
};

export default async function OwnerInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ invoiceId }, sp] = await Promise.all([params, searchParams]);
  const actor = await requirePermission('invoices.manage');
  const d = await ownerInvoice(getDb(), actor, invoiceId);
  const inv = d.inv;
  const issued = Boolean(inv.number);
  const creditable = d.lines.filter((l) => !l.creditedBy && l.amountPence > 0);
  const title = inv.number ? `Invoice ${inv.number}` : `Draft invoice – ${formatMonth(inv.periodMonth)}`;
  return (
    <Stack>
      <p>
        <Link href="/admin/invoices">← All invoices</Link>
      </p>
      <h1>{title}</h1>
      {sp.done && DONE[sp.done] ? <Alert tone="success">{DONE[sp.done]}</Alert> : null}
      <p>
        <InvoiceState state={d.state} /> <Link href={`/admin/customers/${inv.customerId}`}>{d.customerName}</Link> ·{' '}
        {formatMonth(inv.periodMonth)}
      </p>

      {inv.status === 'draft' ? (
        <Card aria-labelledby="approve">
          <h2 id="approve">Check and approve</h2>
          <p>
            This draft lists every booked member day for {formatMonth(inv.periodMonth)} that hasn’t been invoiced yet.
            It updates automatically if days are cancelled or added. When you approve it, it gets its invoice number and
            is sent {inv.periodMonth > londonDate(new Date()).slice(0, 7) ? 'on the send day' : 'straight away'}.
          </p>
          <ActionForm action={approveInvoiceAction}>
            <input type="hidden" name="id" value={inv.id} />
            <input type="hidden" name="version" value={inv.version} />
            <input type="hidden" name="expectedTotalPence" value={inv.totalPence} />
            <div>
              <SubmitButton pendingText="Approving…">Approve invoice for {pounds(inv.totalPence)}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}
      {inv.status === 'scheduled' ? (
        <Card aria-labelledby="scheduled">
          <h2 id="scheduled">Approved – waiting to send</h2>
          <p>It will be emailed on {inv.scheduledFor ? formatDateTimeLondon(inv.scheduledFor) : 'the send day'}.</p>
          <ActionForm action={unapproveInvoiceAction}>
            <input type="hidden" name="id" value={inv.id} />
            <input type="hidden" name="version" value={inv.version} />
            <div>
              <SubmitButton variant="secondary">Back to draft</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <Card aria-labelledby="summary">
        <h2 id="summary">Summary</h2>
        <dl className={s.dl}>
          <dt>Total</dt>
          <dd>{pounds(d.bal.totalPence)}</dd>
          {d.bal.creditedPence ? (
            <>
              <dt>Credited</dt>
              <dd>{pounds(d.bal.creditedPence)}</dd>
            </>
          ) : null}
          {d.bal.paidPence ? (
            <>
              <dt>Paid</dt>
              <dd>{pounds(d.bal.paidPence)}</dd>
            </>
          ) : null}
          {issued ? (
            <>
              <dt>Still owed</dt>
              <dd>
                <strong>{pounds(d.bal.duePence)}</strong>
              </dd>
              <dt>Invoice date</dt>
              <dd>{formatUkDate(inv.issueDate!)}</dd>
              <dt>Due</dt>
              <dd>{formatUkDate(inv.dueDate!)}</dd>
              <dt>Reminder</dt>
              <dd>
                {inv.reminderSentAt
                  ? `Sent ${formatDateTimeLondon(inv.reminderSentAt)}`
                  : inv.reminderDueAt
                    ? `If unpaid, ${formatDateTimeLondon(inv.reminderDueAt)}`
                    : '–'}
              </dd>
            </>
          ) : null}
        </dl>
        {issued ? (
          <div className={s.row}>
            <a className={s.button + ' ' + s.secondary} href={`/api/invoices/${inv.id}/pdf`}>
              Download PDF
            </a>
            <ActionForm action={resendInvoiceAction}>
              <input type="hidden" name="id" value={inv.id} />
              <SubmitButton variant="ghost">Email it again</SubmitButton>
            </ActionForm>
          </div>
        ) : null}
      </Card>

      <Card aria-labelledby="days">
        <h2 id="days">Days ({d.lines.length})</h2>
        <div className={s.tableWrap} role="region" aria-label="Invoice days" tabIndex={0}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Price</th>
                <th scope="col">Amount</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className={s.hint}>{l.explanation}</td>
                  <td>{pounds(l.amountPence)}</td>
                  <td>
                    {l.creditedBy ? `Credited (${l.creditedBy})` : null}
                    {l.refund && l.refund.status === 'requested' ? (
                      <StatusBadge tone="warning">Refund requested</StatusBadge>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {issued && d.bal.duePence > 0 ? (
        <Card aria-labelledby="pay">
          <h2 id="pay">Record a payment</h2>
          <p className={s.hint}>
            Customers pay by card from their invoice. Use this only for money received another way – the reason is kept
            in the audit log.
          </p>
          <ActionForm action={recordPaymentAction}>
            <input type="hidden" name="id" value={inv.id} />
            <TextField
              name="amount"
              label="Amount (£)"
              inputMode="decimal"
              defaultValue={(d.bal.duePence / 100).toFixed(2)}
              required
            />
            <TextField name="receivedOn" label="Date paid" type="date" defaultValue={londonDate(new Date())} required />
            <TextField name="reason" label="Why are you recording this by hand?" required />
            <div>
              <SubmitButton>Record payment</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      {issued && inv.status !== 'void' ? (
        <Card aria-labelledby="credit">
          <h2 id="credit">Issue a credit note</h2>
          <p className={s.hint}>
            Sent invoices can’t be changed. To take something off, issue a credit note. If the invoice was already paid
            by card, the credited amount goes back to the card automatically.
          </p>
          <ActionForm action={creditInvoiceAction}>
            <input type="hidden" name="id" value={inv.id} />
            {creditable.length ? (
              <fieldset className={s.fieldset}>
                <legend>Days to credit</legend>
                <FieldError name="lineIds" />
                {creditable.map((l) => (
                  <label key={l.id} className={s.choice}>
                    <input type="checkbox" name="lineIds" value={l.id} /> {l.description} ({pounds(l.amountPence)})
                  </label>
                ))}
              </fieldset>
            ) : null}
            <TextField
              name="amount"
              label="Or an amount (£)"
              hint="Leave blank if you’ve ticked days."
              inputMode="decimal"
              required={false}
            />
            <TextField name="reason" label="Reason (shown on the credit note)" required />
            <div>
              <SubmitButton variant="secondary">Issue credit note</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}

      {d.creditNotes.length || d.payments.length ? (
        <Card aria-labelledby="history">
          <h2 id="history">Credits and payments</h2>
          <ul className={s.list}>
            {d.creditNotes.map((c) => (
              <li key={c.id}>
                Credit note {c.number} ({formatUkDate(c.issueDate)}): {pounds(c.amountPence)} – {c.reason}
                {c.refundState === 'awaiting_refund' ? (
                  <>
                    {' '}
                    <StatusBadge tone="warning">{pounds(c.refundDuePence)} to refund</StatusBadge>
                  </>
                ) : null}
                {c.refundState === 'refunded' ? (
                  <>
                    {' '}
                    <StatusBadge tone="success">Refunded</StatusBadge>
                  </>
                ) : null}
              </li>
            ))}
            {d.payments.map((p) => (
              <li key={p.id}>
                Payment {formatUkDate(p.receivedOn)}: {pounds(p.amountPence)} –{' '}
                {p.method === 'stripe' ? 'card' : `recorded by hand (${p.reason})`}
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Muted>No credits or payments yet.</Muted>
      )}
    </Stack>
  );
}
