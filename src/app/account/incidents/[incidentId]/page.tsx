import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myIncident } from '@/server/services/welfare';
import { formatDateTimeLondon } from '@/ui/format';
import { INCIDENT_KIND_LABELS, SEVERITY_LABELS, SEVERITY_TONE } from '@/ui/welfare-labels';
import { acknowledgeIncidentAction } from '../../actions';

export const metadata: Metadata = { title: 'Incident report' };
export const dynamic = 'force-dynamic';

export default async function MyIncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const actor = await requirePermission('account.access');
  const d = await myIncident(getDb(), actor, incidentId);
  const i = d.inc;
  return (
    <Stack>
      <p>
        <Link href={`/account/dogs/${i.dogId}`}>← {d.dogName}</Link>
      </p>
      <h1>Incident report – {d.dogName}</h1>
      <p>
        <StatusBadge tone={SEVERITY_TONE[i.severity]!}>{SEVERITY_LABELS[i.severity]}</StatusBadge>{' '}
        {INCIDENT_KIND_LABELS[i.kind]} · {formatDateTimeLondon(i.occurredAt)}
      </p>
      <Card aria-labelledby="report">
        <h2 id="report">What happened</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{i.description}</p>
        <h2>What we did</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{i.actionTaken}</p>
        {i.vetContacted ? (
          <>
            <h2>Vet’s advice</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{i.vetAdvice}</p>
          </>
        ) : null}
        {d.photos.length ? (
          <>
            <h2>Photos</h2>
            <ul className={s.list}>
              {d.photos.map((p) => (
                <li key={p.id}>
                  <a href={`/api/documents/${p.id}`}>{p.name}</a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>
      {d.updates.length ? (
        <Card aria-labelledby="updates">
          <h2 id="updates">Updates</h2>
          <ul className={s.list}>
            {d.updates.map((u) => (
              <li key={u.id}>
                <span className={s.hint}>{formatDateTimeLondon(u.createdAt)}</span>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{u.body}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {i.acknowledgedAt ? (
        <Alert tone="success">You confirmed you’d read this on {formatDateTimeLondon(i.acknowledgedAt)}.</Alert>
      ) : (
        <Card>
          <p>Please let us know you’ve read this. If you have any questions, just call us.</p>
          <ActionForm action={acknowledgeIncidentAction}>
            <input type="hidden" name="id" value={i.id} />
            <div>
              <SubmitButton>I’ve read this</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}
    </Stack>
  );
}
