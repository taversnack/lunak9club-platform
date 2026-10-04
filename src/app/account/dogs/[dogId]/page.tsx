import type { Metadata, Route } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myDogWelfare, myIncidents } from '@/server/services/welfare';
import { CONCERN_LABELS } from '@/domain/compliance/welfare';
import { formatDateTimeLondon } from '@/ui/format';
import { ATE_LABELS, DRINKING_LABELS, INCIDENT_KIND_LABELS, MOOD_LABELS } from '@/ui/welfare-labels';

import { Alert, buttonClass, Card, Stack, StatusBadge } from '@/ui/components';
import { ITEM_LABELS, OVERALL_LABELS, type ChecklistItem } from '@/domain/compliance/evaluate';
import { formatUkDate } from '@/domain/time';
import { loadDogPage } from './load';

export const metadata: Metadata = { title: 'Your dog' };
export const dynamic = 'force-dynamic';

const SAVED: Record<string, string> = {
  details: 'Details saved.',
  vet: 'Vet details saved.',
  onboarding: 'Thank you – your onboarding form has been sent.',
  upload: 'Thank you – we’ll check the record and let you know.',
};

function actionLink(dogId: string, item: ChecklistItem) {
  if (!item.action) return null;
  const href =
    item.kind === 'vaccination'
      ? `/account/dogs/${dogId}/vaccinations`
      : item.kind === 'vet_details'
        ? `/account/dogs/${dogId}/vet`
        : item.kind === 'onboarding_form'
          ? `/account/dogs/${dogId}/onboarding`
          : item.kind === 'emergency_contact'
            ? '/account/contacts'
            : item.kind === 'terms'
              ? '/account/terms'
              : null;
  return href ? <Link href={href as Route}>{item.action}</Link> : <span>{item.action}</span>;
}

export default async function DogPage({
  params,
  searchParams,
}: {
  params: Promise<{ dogId: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { dogId } = await params;
  const { saved } = await searchParams;
  const { dog, evaluation, submissions, vet } = await loadDogPage(dogId);
  const actor = await requirePermission('account.access');
  const [dogIncidents, notes] = await Promise.all([
    myIncidents(getDb(), actor, { dogId: dog.id }),
    myDogWelfare(getDb(), actor, dog.id),
  ]);
  const unread = dogIncidents.filter((i) => !i.acknowledgedAt);
  const overall = OVERALL_LABELS[evaluation.overall];
  return (
    <Stack>
      <p className={s.breadcrumb}>
        <Link href="/account">Your account</Link> › {dog.name}
      </p>
      <div className={s.row}>
        <h1>{dog.name}</h1>
        <StatusBadge tone={overall.tone}>{overall.text}</StatusBadge>
      </div>
      {saved && SAVED[saved] ? <Alert tone="success">{SAVED[saved]}</Alert> : null}
      {dog.status === 'suspended' || dog.status === 'rejected' ? (
        <Alert tone="danger" title={dog.status === 'suspended' ? 'Bookings are paused' : 'Not accepted'}>
          {dog.statusReason}
        </Alert>
      ) : null}
      {evaluation.overall === 'ready_for_approval' ? (
        <Alert tone="info">Everything is in. We’ll review {dog.name} and let you know.</Alert>
      ) : null}

      {unread.map((i) => (
        <Alert key={i.id} tone="warning" title={`Please read: incident report for ${dog.name}`}>
          <Link href={`/account/incidents/${i.id}`}>
            {INCIDENT_KIND_LABELS[i.kind]} on {formatDateTimeLondon(i.occurredAt)}
          </Link>
        </Alert>
      ))}

      <Card aria-labelledby="checklist">
        <h2 id="checklist">Onboarding checklist</h2>
        <ul className={s.list}>
          {evaluation.items.map((i) => {
            const st = ITEM_LABELS[i.state];
            return (
              <li key={i.key} className={s.listItem}>
                <div>
                  <strong>{i.label}</strong>
                  {i.expiresOn && (i.state === 'met' || i.state === 'expiring_soon' || i.state === 'expired') ? (
                    <div className={s.hint}>Valid until {formatUkDate(i.expiresOn)}</div>
                  ) : null}
                  {i.renewalPending ? <div className={s.hint}>New record waiting for review</div> : null}
                  <div>{actionLink(dog.id, i)}</div>
                </div>
                <StatusBadge tone={st.tone}>{st.text}</StatusBadge>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card aria-labelledby="about">
        <div className={s.row}>
          <h2 id="about">About {dog.name}</h2>
          <Link href={`/account/dogs/${dog.id}/details`} className={buttonClass('secondary')}>
            Edit details
          </Link>
        </div>
        <dl className={s.dl}>
          <dt>Breed</dt>
          <dd>{dog.breed}</dd>
          <dt>Date of birth</dt>
          <dd>{dog.dateOfBirth ? formatUkDate(dog.dateOfBirth) : '–'}</dd>
          <dt>Weight</dt>
          <dd>{dog.weightKg ? `${dog.weightKg} kg` : '–'}</dd>
          <dt>Microchip</dt>
          <dd>{dog.microchipNumber ?? '–'}</dd>
          <dt>Vet</dt>
          <dd>{vet ? `${vet.practiceName}, ${vet.phone}` : 'Not added yet'}</dd>
        </dl>
        <p>
          <Link href={`/account/dogs/${dog.id}/vet`}>Update vet details</Link> ·{' '}
          <Link href={`/account/dogs/${dog.id}/onboarding`}>Update health, behaviour and permissions</Link>
        </p>
      </Card>

      <Card aria-labelledby="records">
        <div className={s.row}>
          <h2 id="records">Vaccination records</h2>
          <Link href={`/account/dogs/${dog.id}/vaccinations`} className={buttonClass('secondary')}>
            Upload a record
          </Link>
        </div>
        {submissions.length === 0 ? (
          <p className={s.muted}>No records uploaded yet.</p>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Vaccination records" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Vaccination</th>
                  <th scope="col">Valid until</th>
                  <th scope="col">Status</th>
                  <th scope="col">File</th>
                </tr>
              </thead>
              <tbody>
                {submissions
                  .filter((x) => x.status !== 'superseded')
                  .map((x) => {
                    const label = evaluation.items.find((i) => i.key === x.requirementKey)?.label ?? x.requirementKey;
                    const st =
                      x.status === 'approved'
                        ? { tone: 'success' as const, text: 'Accepted' }
                        : x.status === 'pending_review'
                          ? { tone: 'info' as const, text: 'Waiting for review' }
                          : x.status === 'rejected'
                            ? { tone: 'danger' as const, text: 'Not accepted' }
                            : { tone: 'warning' as const, text: 'New copy needed' };
                    return (
                      <tr key={x.id}>
                        <td>{label}</td>
                        <td>{formatUkDate(x.expiresOn)}</td>
                        <td>
                          <StatusBadge tone={st.tone}>{st.text}</StatusBadge>
                          {x.reviewReason ? <div className={s.hint}>{x.reviewReason}</div> : null}
                        </td>
                        <td>
                          <a href={`/api/documents/${x.documentId}`} target="_blank" rel="noopener">
                            {x.documentName}
                          </a>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {dogIncidents.length || notes.length ? (
        <Card aria-labelledby="day-care">
          <h2 id="day-care">From day care</h2>
          {dogIncidents.length ? (
            <>
              <h3>Incident reports</h3>
              <ul className={s.list}>
                {dogIncidents.map((i) => (
                  <li key={i.id}>
                    <Link href={`/account/incidents/${i.id}`}>
                      {INCIDENT_KIND_LABELS[i.kind]} – {formatDateTimeLondon(i.occurredAt)}
                    </Link>
                    {i.acknowledgedAt ? '' : ' (not read yet)'}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {notes.length ? (
            <>
              <h3>Notes from our team</h3>
              <ul className={s.list}>
                {notes.map((n) => (
                  <li key={n.id}>
                    <strong>{formatUkDate(n.serviceDate)}</strong>: {ATE_LABELS[n.ate]} · {DRINKING_LABELS[n.drinking]}{' '}
                    · {MOOD_LABELS[n.mood]}
                    {n.concerns.length ? ` · ${n.concerns.map((c) => CONCERN_LABELS[c]).join(', ')}` : ''}
                    {n.medicationGiven ? ` · Medication given: ${n.medicationGiven}` : ''}
                    {n.note ? <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{n.note}</p> : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ) : null}
    </Stack>
  );
}
