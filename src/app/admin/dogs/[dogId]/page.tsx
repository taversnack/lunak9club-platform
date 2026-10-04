import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import s from '@/ui/ui.module.css';
import { dogWelfare } from '@/server/services/welfare';
import { INCIDENT_KIND_LABELS, SEVERITY_LABELS, SEVERITY_TONE } from '@/ui/welfare-labels';
import { Alert, buttonClass, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, RadioGroup, SelectField, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDogForOwner } from '@/server/services/owner-review';
import { NotFoundError } from '@/server/errors';
import { getDb } from '@/infra/db/client';
import { ITEM_LABELS, OVERALL_LABELS } from '@/domain/compliance/evaluate';
import { formatUkDate, londonDate } from '@/domain/time';
import { formatDateTimeLondon } from '@/ui/format';
import { recordAssessmentAction, reviewSubmissionAction, setDogStatusAction } from '../../actions';

export const metadata: Metadata = { title: 'Dog' };
export const dynamic = 'force-dynamic';

const yn = (v: boolean | null | undefined) => (v == null ? '–' : v ? 'Yes' : 'No');
const txt = (v: string | null | undefined) => v || '–';

export default async function OwnerDogPage({ params }: { params: Promise<{ dogId: string }> }) {
  const actor = await requirePermission('dogs.read_sensitive');
  const { dogId } = await params;
  let d;
  try {
    d = await getDogForOwner(getDb(), actor, dogId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { dog, evaluation: ev } = d;
  const overall = OVERALL_LABELS[ev.overall];
  const pending = d.submissions.filter((x) => x.status === 'pending_review');
  const history = d.submissions.filter((x) => x.status !== 'pending_review');
  const today = londonDate(new Date());
  const welfare = await dogWelfare(getDb(), actor, dogId);
  const lastCheck = welfare.checks[0];

  return (
    <Stack>
      <p className={s.breadcrumb}>
        <Link href={`/admin/customers/${d.customerId}`}>{d.customerName}</Link> › {dog.name}
      </p>
      <div className={s.row}>
        <h1>{dog.name}</h1>
        <StatusBadge tone={overall.tone}>{overall.text}</StatusBadge>
      </div>

      <div className={s.two}>
        <Card aria-labelledby="checklist">
          <h2 id="checklist">Checklist</h2>
          <ul className={s.list}>
            {ev.items.map((i) => {
              const st = ITEM_LABELS[i.state];
              return (
                <li key={i.key} className={s.listItem}>
                  <span>
                    {i.label}
                    {i.expiresOn ? <span className={s.hint}> · until {formatUkDate(i.expiresOn)}</span> : null}
                    {!i.mandatory ? <span className={s.hint}> · optional</span> : null}
                  </span>
                  <StatusBadge tone={st.tone}>{st.text}</StatusBadge>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card aria-labelledby="decision">
          <h2 id="decision">Day care approval</h2>
          <p>
            Current status: <strong>{dog.status.replace('_', ' ')}</strong>
            {dog.approvedAt ? ` · approved ${formatDateTimeLondon(dog.approvedAt)}` : ''}
          </p>
          {!ev.allMandatoryMet && dog.status !== 'approved' ? (
            <Alert tone="info">Approval is available once every required item is done.</Alert>
          ) : null}
          <ActionForm action={setDogStatusAction}>
            <input type="hidden" name="dogId" value={dog.id} />
            <input type="hidden" name="version" value={dog.version} />
            <SelectField
              name="status"
              label="Change status to"
              options={[
                ...(ev.allMandatoryMet ? [{ value: 'approved', label: 'Approved for day care' }] : []),
                { value: 'suspended', label: 'Suspended (pause bookings)' },
                { value: 'rejected', label: 'Not accepted' },
                { value: 'not_started', label: 'Back to onboarding' },
              ]}
            />
            <TextArea
              name="reason"
              label="Reason shown to the customer"
              hint="Needed when suspending or not accepting"
            />
            <div>
              <SubmitButton>Update status</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>

      <Card aria-labelledby="pending">
        <h2 id="pending">Records waiting for review ({pending.length})</h2>
        {pending.length === 0 ? <Muted>Nothing waiting.</Muted> : null}
        {pending.map((p) => (
          <section key={p.id} aria-labelledby={`sub-${p.id}`} className={s.listItem} style={{ display: 'block' }}>
            <h3 id={`sub-${p.id}`}>{p.requirementLabel}</h3>
            <p>
              Sent {formatDateTimeLondon(p.submittedAt)} · customer says valid until {formatUkDate(p.expiresOn)} ·{' '}
              <a href={`/api/documents/${p.documentId}`} target="_blank" rel="noopener">
                Open {p.documentName}
              </a>
            </p>
            <ActionForm action={reviewSubmissionAction}>
              <input type="hidden" name="submissionId" value={p.id} />
              <input type="hidden" name="dogId" value={dog.id} />
              <input type="hidden" name="version" value={p.version} />
              <TextField
                name="expiresOn"
                label="Valid until"
                type="date"
                required
                defaultValue={p.expiresOn}
                hint="Correct this if it doesn’t match the record"
              />
              <RadioGroup
                name="decision"
                label="Decision"
                options={[
                  { value: 'approve', label: 'Accept' },
                  { value: 'request_replacement', label: 'Ask for a new copy' },
                  { value: 'reject', label: 'Reject' },
                ]}
              />
              <TextArea
                name="reason"
                label="Message to the customer"
                hint="Needed if you ask for a new copy or reject"
              />
              <div>
                <SubmitButton>Save decision</SubmitButton>
              </div>
            </ActionForm>
          </section>
        ))}
      </Card>

      <Card aria-labelledby="assessments">
        <h2 id="assessments">Meet and greet and trial day</h2>
        {d.assessments.length === 0 ? (
          <Muted>No assessments recorded yet.</Muted>
        ) : (
          <ul className={s.list}>
            {d.assessments.map((a) => (
              <li key={a.id} className={s.listItem}>
                <div>
                  <strong>{a.kind === 'trial_day' ? 'Trial day' : 'Meet and greet'}</strong> ·{' '}
                  {formatUkDate(a.assessedOn)}
                  {a.internalNotes ? (
                    <div className={`${s.hint} ${s.pre}`}>Internal note: {a.internalNotes}</div>
                  ) : null}
                </div>
                <StatusBadge tone={a.outcome === 'passed' ? 'success' : a.outcome === 'not_passed' ? 'danger' : 'info'}>
                  {a.outcome === 'passed' ? 'Passed' : a.outcome === 'not_passed' ? 'Not passed' : 'Rescheduled'}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
        <h3>Record an assessment</h3>
        <ActionForm action={recordAssessmentAction}>
          <input type="hidden" name="dogId" value={dog.id} />
          <RadioGroup
            name="kind"
            label="Assessment"
            options={[
              { value: 'meet_and_greet', label: 'Meet and greet' },
              { value: 'trial_day', label: 'Trial day' },
            ]}
          />
          <RadioGroup
            name="outcome"
            label="Outcome"
            options={[
              { value: 'passed', label: 'Passed' },
              { value: 'not_passed', label: 'Not passed' },
              { value: 'rescheduled', label: 'Rescheduled' },
            ]}
          />
          <TextField name="assessedOn" label="Date" type="date" required defaultValue={today} max={today} />
          <TextArea name="internalNotes" label="Internal notes" hint="Only you can see these" />
          <div>
            <SubmitButton>Record assessment</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <div className={s.two}>
        <Card aria-labelledby="about">
          <h2 id="about">About</h2>
          <dl className={s.dl}>
            <dt>Breed</dt>
            <dd>{txt(dog.breed)}</dd>
            <dt>Sex</dt>
            <dd>{txt(dog.sex)}</dd>
            <dt>Date of birth</dt>
            <dd>{dog.dateOfBirth ? formatUkDate(dog.dateOfBirth) : '–'}</dd>
            <dt>Weight</dt>
            <dd>{dog.weightKg ? `${dog.weightKg} kg` : '–'}</dd>
            <dt>Microchip</dt>
            <dd>{txt(dog.microchipNumber)}</dd>
            <dt>Neutered</dt>
            <dd>{yn(dog.neutered)}</dd>
            <dt>Vet</dt>
            <dd>
              {d.vet ? `${d.vet.practiceName}${d.vet.vetName ? ` (${d.vet.vetName})` : ''}, ${d.vet.phone}` : '–'}
            </dd>
            <dt>Owner</dt>
            <dd>
              {d.customerName} · {d.customerPhone ?? 'no phone'} · {d.customerEmail}
            </dd>
          </dl>
        </Card>
        <Card aria-labelledby="perms">
          <h2 id="perms">Permissions</h2>
          <dl className={s.dl}>
            <dt>Dog taxi</dt>
            <dd>{yn(d.permissions?.transport)}</dd>
            <dt>Photos on social media</dt>
            <dd>{yn(d.permissions?.photosAndSocialMedia)}</dd>
            <dt>Emergency vet treatment</dt>
            <dd>{yn(d.permissions?.emergencyVetTreatment)}</dd>
          </dl>
          <h3>Contacts</h3>
          {d.contacts.length === 0 ? (
            <Muted>None.</Muted>
          ) : (
            <ul>
              {d.contacts.map((c) => (
                <li key={c.id}>
                  {c.name} – {c.phone} {c.isEmergencyContact ? '· emergency' : ''}{' '}
                  {c.isAuthorisedCollector ? '· can collect' : ''}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card aria-labelledby="health">
        <div className={s.sensitive} style={{ paddingLeft: 'var(--space-3)' }}>
          <h2 id="health">Health and behaviour</h2>
          <p className={s.hint}>Sensitive – for Luna’s K9 Club use only. Your viewing of this page is recorded.</p>
          <dl className={s.dl}>
            <dt>Allergies</dt>
            <dd>{txt(d.health?.allergies)}</dd>
            <dt>Medication</dt>
            <dd>{txt(d.health?.medication)}</dd>
            <dt>Diet</dt>
            <dd>{txt(d.health?.dietaryRequirements)}</dd>
            <dt>Medical conditions</dt>
            <dd>{txt(d.health?.medicalConditions)}</dd>
            <dt>Flea and worming</dt>
            <dd>{txt(d.health?.fleaAndWorming)}</dd>
            <dt>Temperament</dt>
            <dd>{txt(d.behaviour?.temperament)}</dd>
            <dt>Triggers</dt>
            <dd>{txt(d.behaviour?.triggers)}</dd>
            <dt>Bite or aggression history</dt>
            <dd>
              {d.behaviour ? d.behaviour.biteHistory ? <StatusBadge tone="warning">Yes</StatusBadge> : 'No' : '–'}
              {d.behaviour?.biteDetails ? <div>{d.behaviour.biteDetails}</div> : null}
            </dd>
            <dt>Handling</dt>
            <dd>{txt(d.behaviour?.handlingInstructions)}</dd>
            <dt>In an emergency</dt>
            <dd>{txt(d.behaviour?.emergencyInstructions)}</dd>
          </dl>
        </div>
      </Card>

      <Card aria-labelledby="welfare">
        <div className={s.row}>
          <h2 id="welfare">Welfare and incidents</h2>
          <div className={s.row}>
            <Link href={`/admin/dogs/${dogId}/check`} className={buttonClass('secondary')}>
              Daily check
            </Link>
            <Link href={`/admin/incidents/new?dogId=${dogId}`} className={buttonClass('secondary')}>
              Report an incident
            </Link>
          </div>
        </div>
        <p>
          {lastCheck
            ? `Last daily check: ${formatUkDate(lastCheck.serviceDate)}${lastCheck.concerns.length ? ' (with concerns)' : ''}.`
            : 'No daily checks yet.'}{' '}
          <Link href={`/admin/dogs/${dogId}/check`}>See all checks</Link>
        </p>
        {welfare.incidents.length === 0 ? (
          <Muted>No incidents.</Muted>
        ) : (
          <ul className={s.list}>
            {welfare.incidents.map((i) => (
              <li key={i.id}>
                <Link href={`/admin/incidents/${i.id}`}>
                  {INCIDENT_KIND_LABELS[i.kind]} – {formatUkDate(londonDate(i.occurredAt))}
                </Link>{' '}
                <StatusBadge tone={SEVERITY_TONE[i.severity]!}>{SEVERITY_LABELS[i.severity]}</StatusBadge>
                {i.status === 'open' ? ' · open' : ''}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="history">
        <h2 id="history">Record history</h2>
        {history.length === 0 ? (
          <Muted>None yet.</Muted>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Record history" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col">Valid until</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">File</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.requirementLabel}</td>
                    <td>{formatUkDate(h.expiresOn)}</td>
                    <td>
                      {h.status === 'approved'
                        ? 'Accepted'
                        : h.status === 'rejected'
                          ? 'Rejected'
                          : h.status === 'superseded'
                            ? 'Replaced'
                            : 'New copy asked for'}
                      {h.reviewReason ? <div className={s.hint}>{h.reviewReason}</div> : null}
                    </td>
                    <td>
                      <a href={`/api/documents/${h.documentId}`} target="_blank" rel="noopener">
                        {h.documentName}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Stack>
  );
}
