import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerRefundRequests } from '@/server/services/billing';
import { ownerCardRefunds } from '@/server/services/card-refunds';
import { SESSION_LABELS, type Session } from '@/domain/booking/rules';
import { pounds } from '@/domain/pricing/engine';
import { formatUkDate } from '@/domain/time';
import { decideRefundAction, markRefundedAction, retryCardRefundAction } from '../actions';

export const metadata: Metadata = { title: 'Refunds' };
export const dynamic = 'force-dynamic';

const DONE: Record<string, string> = {
  approved: 'Refund approved. A credit note has been issued and the customer emailed.',
  declined: 'Refund declined. The customer has been emailed your reason.',
  refunded: 'Marked as refunded.',
  retried: 'Refund sent to the card again.',
};

export default async function RefundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('refunds.manage');
  const [{ open, decided, awaiting }, card] = await Promise.all([
    ownerRefundRequests(getDb(), actor),
    ownerCardRefunds(getDb(), actor),
  ]);
  return (
    <Stack>
      <h1>Refunds</h1>
      {sp.done && DONE[sp.done] ? <Alert tone="success">{DONE[sp.done]}</Alert> : null}
      <Card aria-labelledby="open">
        <h2 id="open">Refund requests ({open.length})</h2>
        <p className={s.hint}>
          A request appears when a member day that has already been invoiced is cancelled 48 hours or more ahead.
          Approving it issues a credit note; if the invoice was paid by card, the money goes back to that card
          automatically.
        </p>
        {open.length === 0 ? <Muted>No refund requests waiting.</Muted> : null}
        <ul className={s.list}>
          {open.map(({ r, number, customerName, dogName, serviceDate, session }) => (
            <li key={r.id} className={s.listItem} style={{ display: 'block' }}>
              <p>
                <strong>
                  {dogName}, {formatUkDate(serviceDate)} ({SESSION_LABELS[session as Session]})
                </strong>{' '}
                · {customerName} · <Link href={`/admin/invoices/${r.invoiceId}`}>{number}</Link> ·{' '}
                {pounds(r.amountPence)}
              </p>
              <div className={s.two}>
                <ActionForm action={decideRefundAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <div>
                    <SubmitButton>
                      Approve refund{' '}
                      <span className="visually-hidden">
                        for {dogName} on {formatUkDate(serviceDate)}
                      </span>
                    </SubmitButton>
                  </div>
                </ActionForm>
                <ActionForm action={decideRefundAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="decision" value="decline" />
                  <TextArea name="reason" label="Reason for declining (the customer sees this)" rows={2} required />
                  <div>
                    <SubmitButton variant="secondary">
                      Decline{' '}
                      <span className="visually-hidden">
                        refund for {dogName} on {formatUkDate(serviceDate)}
                      </span>
                    </SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card aria-labelledby="awaiting">
        <h2 id="awaiting">Money to return ({awaiting.length})</h2>
        <p className={s.hint}>
          Credits on invoices that were already paid. Anything paid by card goes back automatically and drops off this
          list once the card company confirms it. Money paid another way needs returning by hand – then mark it here.
        </p>
        {awaiting.length === 0 ? <Muted>Nothing to return.</Muted> : null}
        <ul className={s.list}>
          {awaiting.map(({ cn, invoiceId, number, customerName }) => (
            <li key={cn.id} className={s.listItem} style={{ display: 'block' }}>
              <p>
                <strong>{pounds(cn.refundDuePence)}</strong> to {customerName} · credit note {cn.number} on{' '}
                <Link href={`/admin/invoices/${invoiceId}`}>{number}</Link>
              </p>
              <ActionForm action={markRefundedAction}>
                <input type="hidden" name="id" value={cn.id} />
                <TextField name="reason" label="How was the money returned?" required />
                <div>
                  <SubmitButton variant="secondary">
                    Mark as refunded <span className="visually-hidden">{cn.number}</span>
                  </SubmitButton>
                </div>
              </ActionForm>
            </li>
          ))}
        </ul>
      </Card>
      <Card aria-labelledby="card">
        <h2 id="card">Card refunds</h2>
        {card.failed.length ? (
          <Alert tone="danger" title={`${card.failed.length} card refund${card.failed.length === 1 ? '' : 's'} failed`}>
            <ul className={s.list}>
              {card.failed.map(({ r, invoiceId }) => (
                <li key={r.id}>
                  {pounds(r.amountPence)} – {r.reason}. <Link href={`/admin/invoices/${invoiceId}`}>Invoice</Link>
                  {r.failureReason ? <span className={s.hint}> ({r.failureReason})</span> : null}
                  <ActionForm action={retryCardRefundAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton variant="secondary">
                      Try again <span className="visually-hidden">{pounds(r.amountPence)} refund</span>
                    </SubmitButton>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {card.recent.length === 0 ? <Muted>No card refunds yet.</Muted> : null}
        <ul className={s.list}>
          {card.recent.map(({ r, invoiceId }) => (
            <li key={r.id}>
              <StatusBadge tone={r.status === 'succeeded' ? 'success' : 'info'}>
                {r.status === 'succeeded' ? 'Refunded' : 'Processing'}
              </StatusBadge>{' '}
              {pounds(r.amountPence)} – {r.reason} · <Link href={`/admin/invoices/${invoiceId}`}>Invoice</Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card aria-labelledby="decided">
        <h2 id="decided">Recently decided</h2>
        {decided.length === 0 ? <Muted>None yet.</Muted> : null}
        <ul className={s.list}>
          {decided.map(({ r, customerName, dogName, serviceDate }) => (
            <li key={r.id}>
              <StatusBadge tone={r.status === 'approved' ? 'success' : 'info'}>
                {r.status === 'approved' ? 'Approved' : 'Declined'}
              </StatusBadge>{' '}
              {dogName}, {formatUkDate(serviceDate)} · {customerName} · {pounds(r.amountPence)}
              {r.declineReason ? ` – ${r.declineReason}` : ''}
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
