import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack } from '@/ui/components';
import { ActionForm, SubmitButton, TextArea } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerApprovalList } from '@/server/services/approvals';
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
  return (
    <Stack>
      <h1>Requests</h1>
      {sp.approved ? <Alert tone="success">Request approved. The customer has been emailed.</Alert> : null}
      {sp.declined ? (
        <Alert tone="info">
          Request declined. The customer has been emailed; any note shows in their account only.
        </Alert>
      ) : null}
      <Card aria-labelledby="waiting">
        <h2 id="waiting">Waiting for you ({items.length})</h2>
        {items.length === 0 ? <Muted>No requests waiting.</Muted> : null}
        <ul className={s.list}>
          {items.map((r) => (
            <li key={r.id} className={s.listItem} style={{ display: 'block' }} data-testid="approval-item">
              <p>
                <strong>{r.label}</strong> · <Link href={`/admin/customers/${r.customerId}`}>{r.customerName}</Link>
                <br />
                {r.summary}
                <br />
                <span className={s.hint}>Sent {formatDateTimeLondon(r.createdAt)}</span>
              </p>
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
