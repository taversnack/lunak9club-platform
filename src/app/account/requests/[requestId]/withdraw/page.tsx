import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myPendingApprovals } from '@/server/services/approvals';
import { withdrawRequestAction } from '../../../actions';

export const metadata: Metadata = { title: 'Withdraw request' };
export const dynamic = 'force-dynamic';

/** Withdraw one of the customer's own waiting requests (any type). No charge (D79). */
export default async function WithdrawRequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const actor = await requirePermission('account.access');
  const { requestId } = await params;
  // Only the customer's own pending requests are listed, so anything else is simply not found.
  const r = (await myPendingApprovals(getDb(), actor)).find((x) => x.id === requestId);
  if (!r) notFound();
  return (
    <Card>
      <Stack>
        <h1>Withdraw this request?</h1>
        <p>
          <strong>{r.label}</strong> – {r.summary}
        </p>
        <p>Anything held for this request is released. There’s no charge.</p>
        <ActionForm action={withdrawRequestAction}>
          <input type="hidden" name="requestId" value={r.id} />
          <input type="hidden" name="from" value="requests" />
          <div className={s.row} style={{ justifyContent: 'flex-start' }}>
            <SubmitButton variant="danger" pendingText="Saving…">
              Yes, withdraw the request
            </SubmitButton>
            <Link href="/account/requests">No, go back</Link>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
