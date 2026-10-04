import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack, StatusBadge } from '@/ui/components';
import { InvoiceState } from '@/ui/invoice-state';
import { ActionForm, SubmitButton } from '@/ui/form';
import { payInvoiceAction } from '../../actions';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myInvoice } from '@/server/services/billing';
import { formatMonth } from '@/domain/billing/rules';
import { pounds } from '@/domain/pricing/engine';
import { formatUkDate } from '@/domain/time';

export const metadata: Metadata = { title: 'Invoice' };
export const dynamic = 'force-dynamic';

const REFUND_TEXT = {
  requested: 'Refund requested',
  approved: 'Refunded as credit',
  declined: 'Refund declined',
} as const;

export default async function MyInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ invoiceId }, sp] = await Promise.all([params, searchParams]);
  const actor = await requirePermission('account.access');
  const d = await myInvoice(getDb(), actor, invoiceId);
  const inv = d.inv;
  return (
    <Stack>
      <p>
        <Link href="/account/invoices">← Your invoices</Link>
      </p>
      <h1>Invoice {inv.number}</h1>
      <p>
        <InvoiceState state={d.state} /> {formatMonth(inv.periodMonth)}
      </p>
      <Card aria-labelledby="summary">
        <h2 id="summary">Summary</h2>
        <dl className={s.dl}>
          <dt>Invoice date</dt>
          <dd>{formatUkDate(inv.issueDate!)}</dd>
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
          <dt>To pay</dt>
          <dd>
            <strong>{pounds(d.bal.duePence)}</strong>
          </dd>
          <dt>Due by</dt>
          <dd>{formatUkDate(inv.dueDate!)}</dd>
        </dl>
        <p>
          <a className={`${s.button} ${s.secondary}`} href={`/api/invoices/${inv.id}/pdf`}>
            Download PDF
          </a>
        </p>
      </Card>
      {sp.payment === 'paid' ? (
        <Alert tone="success" title="Payment received">
          Thank you – we’ve emailed your receipt.
        </Alert>
      ) : null}
      {sp.payment === 'processing' ? (
        <Alert tone="info" title="Checking your payment">
          We haven’t had confirmation from the card company yet. Please don’t pay twice – this page updates when it
          arrives.
        </Alert>
      ) : null}
      {sp.payment === 'cancelled' ? <Alert tone="warning">Payment not finished. You can try again below.</Alert> : null}
      {d.bal.duePence > 0 ? (
        <Card aria-labelledby="pay">
          <h2 id="pay">Pay this invoice</h2>
          <p>
            {pounds(d.bal.duePence)} to pay by {formatUkDate(inv.dueDate!)}. You’ll pay on a secure card payment page.
          </p>
          <ActionForm action={payInvoiceAction}>
            <input type="hidden" name="invoiceId" value={inv.id} />
            <div>
              <SubmitButton pendingText="Opening payment page…">Pay {pounds(d.bal.duePence)} by card</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}
      <Card aria-labelledby="days">
        <h2 id="days">Days</h2>
        <div className={s.tableWrap} role="region" aria-label="Days on this invoice" tabIndex={0}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Amount</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.description}
                    <br />
                    <span className={s.hint}>{l.explanation}</span>
                  </td>
                  <td>{pounds(l.amountPence)}</td>
                  <td>
                    {l.creditedBy ? 'Credited' : null}
                    {l.refund ? (
                      <StatusBadge tone={l.refund.status === 'declined' ? 'info' : 'success'}>
                        {REFUND_TEXT[l.refund.status]}
                      </StatusBadge>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {d.creditNotes.length ? (
        <Card aria-labelledby="credits">
          <h2 id="credits">Credit notes</h2>
          <ul className={s.list}>
            {d.creditNotes.map((c) => (
              <li key={c.id}>
                {c.number} ({formatUkDate(c.issueDate)}): {pounds(c.amountPence)} – {c.reason}
                {c.refundState === 'awaiting_refund'
                  ? ` · ${pounds(c.refundDuePence)} being refunded to your card`
                  : ''}
                {c.refundState === 'refunded' ? ` · ${pounds(c.refundDuePence)} refunded` : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Stack>
  );
}
