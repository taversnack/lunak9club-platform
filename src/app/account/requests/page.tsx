import type { Metadata, Route } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myApprovalRequests } from '@/server/services/approvals';
import { formatDateTimeLondon } from '@/ui/format';

export const metadata: Metadata = { title: 'Your requests' };
export const dynamic = 'force-dynamic';

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for Luna’s K9 Club',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};

/** Every request the customer has sent (D77), with withdraw for those still waiting. */
export default async function MyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('account.access');
  const items = await myApprovalRequests(getDb(), actor, { status: 'all' });
  const waiting = items.filter((i) => i.status === 'pending');
  const done = items.filter((i) => i.status !== 'pending');
  return (
    <Stack>
      <h1>Your requests</h1>
      {sp.withdrawn ? <Alert tone="info">Your request has been withdrawn. There’s no charge.</Alert> : null}
      <Card aria-labelledby="waiting">
        <h2 id="waiting">Waiting ({waiting.length})</h2>
        {waiting.length === 0 ? <Muted>Nothing waiting.</Muted> : null}
        <ul className={s.list}>
          {waiting.map((r) => (
            <li key={r.id} className={s.listItem}>
              <span>
                <strong>{r.label}</strong> · {r.summary}
                <br />
                <span className={s.hint}>
                  {STATUS_TEXT[r.status]} · sent {formatDateTimeLondon(r.createdAt)}
                </span>
              </span>
              <Link href={`/account/requests/${r.id}/withdraw` as Route}>
                Withdraw <span className="visually-hidden">{r.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Card aria-labelledby="history">
        <h2 id="history">Earlier requests</h2>
        {done.length === 0 ? <Muted>None yet.</Muted> : null}
        <ul className={s.list}>
          {done.map((r) => (
            <li key={r.id} className={s.listItem}>
              <span>
                <strong>{r.label}</strong> · {r.summary}
                <br />
                <span className={s.hint}>
                  {STATUS_TEXT[r.status] ?? r.status}
                  {r.decidedAt ? ` · ${formatDateTimeLondon(r.decidedAt)}` : ''}
                </span>
                {r.reason ? (
                  <>
                    <br />
                    Note from Luna’s K9 Club: {r.reason}
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
