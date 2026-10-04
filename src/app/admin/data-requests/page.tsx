import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, SubmitButton, TextArea } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerDataRequests } from '@/server/services/privacy';
import { formatDateTimeLondon } from '@/ui/format';
import { formatUkDate } from '@/domain/time';
import { decideErasureAction } from '../actions';

export const metadata: Metadata = { title: 'Data requests' };
export const dynamic = 'force-dynamic';

const DONE: Record<string, string> = {
  closed:
    'Account closed. The customer can no longer sign in; their remaining details will be removed on the date shown.',
  erased: 'Account closed and personal details removed.',
  declined: 'Request declined. The customer has been emailed your reason.',
};
const STATUS: Record<string, { tone: 'info' | 'success' | 'warning'; text: string }> = {
  requested: { tone: 'warning', text: 'Waiting for you' },
  approved: { tone: 'info', text: 'Account closed' },
  declined: { tone: 'info', text: 'Declined' },
  completed: { tone: 'success', text: 'Details removed' },
};

export default async function DataRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('data_requests.manage');
  const rows = await ownerDataRequests(getDb(), actor);
  return (
    <Stack>
      <h1>Data requests</h1>
      {sp.done && DONE[sp.done] ? <Alert tone="success">{DONE[sp.done]}</Alert> : null}
      <p className={s.hint}>
        Customers can download their own data from their account. When one asks to delete their account, approving
        closes it straight away. Records the law makes you keep (the day care register, incidents and health records for
        3 years after their last visit; invoices for 6 years) are kept until then and removed automatically. Reply
        within one month (UK GDPR).
      </p>
      <Card>
        {rows.length === 0 ? <Muted>No requests.</Muted> : null}
        <ul className={s.list}>
          {rows.map(({ r, customerName, blockers }) => (
            <li key={r.id} className={s.listItem} style={{ display: 'block' }}>
              <p>
                <strong>{customerName}</strong> asked to delete their account on {formatDateTimeLondon(r.requestedAt)}{' '}
                <StatusBadge tone={STATUS[r.status]!.tone}>{STATUS[r.status]!.text}</StatusBadge>
              </p>
              {r.customerReason ? <p className={s.hint}>Their reason: {r.customerReason}</p> : null}
              {r.retainUntil && r.status === 'approved' ? (
                <p className={s.hint}>Remaining details removed by {formatUkDate(r.retainUntil)}.</p>
              ) : null}
              {r.status === 'requested' ? (
                <>
                  {blockers.length ? (
                    <Alert tone="warning" title="Sort these out first">
                      {blockers.join('; ')}.
                    </Alert>
                  ) : null}
                  <div className={s.two}>
                    <ActionForm action={decideErasureAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <div>
                        <SubmitButton variant="danger">
                          Close account <span className="visually-hidden">for {customerName}</span>
                        </SubmitButton>
                      </div>
                    </ActionForm>
                    <ActionForm action={decideErasureAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="decline" />
                      <TextArea name="reason" label="Reason for declining (the customer sees this)" rows={2} required />
                      <div>
                        <SubmitButton variant="secondary">
                          Decline <span className="visually-hidden">request from {customerName}</span>
                        </SubmitButton>
                      </div>
                    </ActionForm>
                  </div>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
