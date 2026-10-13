import type { Metadata, Route } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, EmptyState, Muted, PageHeader, Stack } from '@/ui/components';
import { ActionForm, SubmitButton, TextArea } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerApprovalList } from '@/server/services/approvals';
import { bookingsMissingPayLink } from '@/server/services/payments';
import { hasPermission } from '@/server/policy/authorize';
import { resendPayLinkAction } from '../actions';
import { formatDateTimeLondon } from '@/ui/format';
import { approveRequestAction, declineRequestAction } from './actions';

export const metadata: Metadata = { title: 'Requests' };
export const dynamic = 'force-dynamic';

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('approvals.manage');
  const items = await ownerApprovalList(getDb(), actor);
  const noLink = hasPermission(actor, 'bookings.manage') ? await bookingsMissingPayLink(getDb(), actor) : [];
  return (
    <Stack>
      <PageHeader
        title="Requests"
        lead="Every kind of request, oldest first. Notes you add are shown to the customer in their account only – never emailed."
      />
      {sp.approved ? <Alert tone="success">Request approved. The customer has been emailed.</Alert> : null}
      {sp.declined ? (
        <Alert tone="info">
          Request declined. The customer has been emailed; any note shows in their account only.
        </Alert>
      ) : null}
      {noLink.length ? (
        <Card aria-labelledby="no-pay-link">
          <h2 id="no-pay-link">Payment links that couldn’t be created ({noLink.length})</h2>
          <p className={s.hint}>
            These were approved, but the card payment service couldn’t be reached, so the customer has no pay link. The
            places stay held until the time shown. The customer can also try “Pay now” in their account.
          </p>
          <ul className={s.list}>
            {noLink.map((m) => (
              <li key={m.bookingId} className={s.listItem} data-testid="pay-link-missing">
                <span>
                  <strong>{m.customerName}</strong> · {m.days.join(', ')}
                  <br />
                  <span className={s.hint}>
                    Held until {formatDateTimeLondon(m.holdUntil)}
                    {m.failedAt ? ` · last tried ${formatDateTimeLondon(m.failedAt)}` : ''}
                  </span>
                </span>
                <ActionForm action={resendPayLinkAction}>
                  <input type="hidden" name="bookingId" value={m.bookingId} />
                  <SubmitButton variant="secondary">
                    Resend pay link <span className="visually-hidden">to {m.customerName}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card aria-labelledby="waiting">
        <h2 id="waiting">Waiting for you ({items.length})</h2>
        {items.length === 0 ? <EmptyState title="No requests waiting." /> : null}
        <ul className={s.list}>
          {items.map((r) => (
            <li key={r.id} className={s.approvalItem} data-testid="approval-item">
              <p>
                <strong>{r.label}</strong> · <Link href={`/admin/customers/${r.customerId}`}>{r.customerName}</Link>
                <br />
                {r.summary}
                <br />
                <span className={s.hint}>Sent {formatDateTimeLondon(r.createdAt)}</span>
              </p>
              {r.lastError ? (
                <Alert tone="warning">
                  Couldn’t approve this
                  {r.lastErrorAt ? ` (tried ${formatDateTimeLondon(r.lastErrorAt)})` : ''}: {r.lastError} It’s still
                  waiting – decline it, or approve again once that’s sorted.
                </Alert>
              ) : null}
              {r.context.map((c) => (
                <div key={c.heading}>
                  <h3>{c.heading}</h3>
                  {c.lines.length === 0 ? (
                    <Muted>None.</Muted>
                  ) : (
                    <ul>
                      {c.lines.map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  )}
                  {c.links?.length ? (
                    <p className={s.hint}>
                      {c.links.map((k, i) => (
                        <span key={k.href + i}>
                          {i ? ' · ' : ''}
                          <Link href={k.href as Route}>{k.label}</Link>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              ))}
              <div className={s.two}>
                <ActionForm action={approveRequestAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <TextArea
                    name="reason"
                    label="Note for the customer (optional, shown in their account only)"
                    rows={2}
                  />
                  <SubmitButton>
                    Approve <span className="visually-hidden">{r.summary}</span>
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={declineRequestAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <TextArea name="reason" label="Reason (optional, shown in their account only)" rows={2} />
                  <SubmitButton variant="secondary">
                    Decline <span className="visually-hidden">{r.summary}</span>
                  </SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
