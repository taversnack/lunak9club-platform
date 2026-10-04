import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, Checkbox, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerIncident } from '@/server/services/welfare';
import { formatDateTimeLondon } from '@/ui/format';
import { formatUkDate } from '@/domain/time';
import { INCIDENT_KIND_LABELS, SEVERITY_LABELS, SEVERITY_TONE } from '@/ui/welfare-labels';
import { incidentStatusAction, incidentUpdateAction } from '../../actions';

export const metadata: Metadata = { title: 'Incident' };
export const dynamic = 'force-dynamic';

const DONE: Record<string, string> = {
  reported: 'Incident saved. The customer has been emailed.',
  updated: 'Update added.',
  closed: 'Incident closed.',
  reopened: 'Incident reopened.',
};

export default async function OwnerIncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ incidentId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ incidentId }, sp] = await Promise.all([params, searchParams]);
  const actor = await requirePermission('incidents.manage');
  const d = await ownerIncident(getDb(), actor, incidentId);
  const i = d.inc;
  return (
    <Stack>
      <p>
        <Link href="/admin/incidents">← Incidents</Link>
      </p>
      <h1>
        {INCIDENT_KIND_LABELS[i.kind]} – {d.dogName}
      </h1>
      {sp.done && DONE[sp.done] ? <Alert tone="success">{DONE[sp.done]}</Alert> : null}
      <p>
        <StatusBadge tone={SEVERITY_TONE[i.severity]!}>{SEVERITY_LABELS[i.severity]}</StatusBadge>{' '}
        <StatusBadge tone={i.status === 'open' ? 'warning' : 'success'}>
          {i.status === 'open' ? 'Open' : 'Closed'}
        </StatusBadge>{' '}
        <Link href={`/admin/dogs/${i.dogId}`}>{d.dogName}</Link> · {d.customerName}
      </p>
      <Card aria-labelledby="report">
        <h2 id="report">Report</h2>
        <dl className={s.dl}>
          <dt>When</dt>
          <dd>{formatDateTimeLondon(i.occurredAt)}</dd>
          <dt>What happened</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{i.description}</dd>
          <dt>What we did</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{i.actionTaken}</dd>
          <dt>Vet</dt>
          <dd>{i.vetContacted ? (i.vetAdvice ?? 'Contacted') : 'Not contacted'}</dd>
          {i.internalNotes ? (
            <>
              <dt>Internal notes</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{i.internalNotes}</dd>
            </>
          ) : null}
          <dt>Customer told</dt>
          <dd>{i.customerNotifiedAt ? formatDateTimeLondon(i.customerNotifiedAt) : 'Email pending'}</dd>
          <dt>Customer read it</dt>
          <dd>{i.acknowledgedAt ? formatDateTimeLondon(i.acknowledgedAt) : 'Not yet'}</dd>
          <dt>Follow-up</dt>
          <dd>{i.followUpDue ? formatUkDate(i.followUpDue) : '–'}</dd>
        </dl>
        {d.photos.length ? (
          <>
            <h3>Photos</h3>
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
      <Card aria-labelledby="updates">
        <h2 id="updates">Updates</h2>
        {d.updates.length === 0 ? <Muted>No updates yet.</Muted> : null}
        <ul className={s.list}>
          {d.updates.map((u) => (
            <li key={u.id}>
              <span className={s.hint}>
                {formatDateTimeLondon(u.createdAt)} · {u.sharedWithCustomer ? 'shared with customer' : 'only you'}
              </span>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{u.body}</p>
            </li>
          ))}
        </ul>
        <ActionForm action={incidentUpdateAction}>
          <input type="hidden" name="id" value={i.id} />
          <TextArea name="body" label="Add an update or correction" rows={3} required />
          <Checkbox name="private" label="Keep this update to myself (don’t show or email the customer)" />
          <TextField name="followUpDue" label="Check back on" type="date" defaultValue={i.followUpDue} />
          <div>
            <SubmitButton variant="secondary">Add update</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      <ActionForm action={incidentStatusAction}>
        <input type="hidden" name="id" value={i.id} />
        <input type="hidden" name="close" value={i.status === 'open' ? '1' : '0'} />
        <div>
          <SubmitButton variant={i.status === 'open' ? 'primary' : 'secondary'}>
            {i.status === 'open' ? 'Close incident' : 'Reopen incident'}
          </SubmitButton>
        </div>
      </ActionForm>
    </Stack>
  );
}
