import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Muted, Stack } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { reviewQueue } from '@/server/services/owner-review';
import { getDb } from '@/infra/db/client';
import { formatDateTimeLondon } from '@/ui/format';
import { formatUkDate } from '@/domain/time';

export const metadata: Metadata = { title: 'Reviews' };
export const dynamic = 'force-dynamic';

export default async function ReviewsPage() {
  const actor = await requirePermission('compliance.review');
  const q = await reviewQueue(getDb(), actor);
  return (
    <Stack>
      <h1>Reviews</h1>
      <Card aria-labelledby="pending">
        <h2 id="pending">Records waiting for review ({q.pending.length})</h2>
        {q.pending.length === 0 ? (
          <Muted>Nothing waiting. Nice.</Muted>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Records waiting for review" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Dog</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Record</th>
                  <th scope="col">Valid until</th>
                  <th scope="col">Sent</th>
                </tr>
              </thead>
              <tbody>
                {q.pending.map((p) => (
                  <tr key={p.submissionId}>
                    <td>
                      <Link href={`/admin/dogs/${p.dogId}`}>{p.dogName}</Link>
                    </td>
                    <td>{p.customerName}</td>
                    <td>{p.requirementLabel}</td>
                    <td>{formatUkDate(p.expiresOn)}</td>
                    <td>{formatDateTimeLondon(p.submittedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card aria-labelledby="ready">
        <h2 id="ready">Ready to approve ({q.ready.length})</h2>
        {q.ready.length === 0 ? (
          <Muted>No dogs are waiting for approval.</Muted>
        ) : (
          <ul className={s.list}>
            {q.ready.map((d) => (
              <li key={d.id} className={s.listItem}>
                <Link href={`/admin/dogs/${d.id}`}>{d.name}</Link>
                <span className={s.muted}>{d.customerName}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card aria-labelledby="assessments">
        <h2 id="assessments">Waiting for meet and greet or trial day ({q.awaitingAssessment.length})</h2>
        {q.awaitingAssessment.length === 0 ? (
          <Muted>None.</Muted>
        ) : (
          <ul className={s.list}>
            {q.awaitingAssessment.map((d) => (
              <li key={d.id} className={s.listItem}>
                <Link href={`/admin/dogs/${d.id}`}>{d.name}</Link>
                <span className={s.muted}>{d.customerName}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Stack>
  );
}
