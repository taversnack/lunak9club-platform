import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, Checkbox, FieldError, RadioGroup, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { getDogForOwner } from '@/server/services/owner-review';
import { dogWelfare } from '@/server/services/welfare';
import { CONCERN_LABELS, MUST_TELL_OWNER } from '@/domain/compliance/welfare';
import { formatUkDate, londonDate } from '@/domain/time';
import { ATE_LABELS, DRINKING_LABELS, MOOD_LABELS, TOILET_LABELS } from '@/ui/welfare-labels';
import { welfareCheckAction, welfareShareAction } from '../../../actions';

export const metadata: Metadata = { title: 'Daily check' };
export const dynamic = 'force-dynamic';

const opts = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));

export default async function DailyCheckPage({
  params,
  searchParams,
}: {
  params: Promise<{ dogId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ dogId }, sp] = await Promise.all([params, searchParams]);
  const actor = await requirePermission('welfare.manage');
  const [dog, history] = await Promise.all([getDogForOwner(getDb(), actor, dogId), dogWelfare(getDb(), actor, dogId)]);
  const name = dog.dog.name;
  return (
    <Stack>
      <p>
        <Link href={`/admin/dogs/${dogId}`}>← {name}</Link>
      </p>
      <h1>Daily check – {name}</h1>
      <Card>
        <ActionForm action={welfareCheckAction}>
          <input type="hidden" name="dogId" value={dogId} />
          {sp.bookingDog ? <input type="hidden" name="bookingDogId" value={sp.bookingDog} /> : null}
          <TextField
            name="serviceDate"
            label="Date"
            type="date"
            defaultValue={sp.date ?? londonDate(new Date())}
            required
          />
          <RadioGroup name="ate" label="Food" options={opts(ATE_LABELS)} />
          <RadioGroup name="drinking" label="Water" options={opts(DRINKING_LABELS)} defaultValue="normal" />
          <RadioGroup name="toileting" label="Toileting" options={opts(TOILET_LABELS)} defaultValue="normal" />
          <RadioGroup name="mood" label="Mood" options={opts(MOOD_LABELS)} />
          <fieldset className={s.fieldset}>
            <legend>Anything the owner must be told about?</legend>
            <FieldError name="concerns" />
            <p className={s.hint}>
              If you tick any of these, or record a change in drinking, the note is shared with the customer and they’re
              emailed (licence requirement).
            </p>
            {MUST_TELL_OWNER.filter((c) => !c.startsWith('drinking')).map((c) => (
              <label key={c} className={s.choice}>
                <input type="checkbox" name="concerns" value={c} /> {CONCERN_LABELS[c]}
              </label>
            ))}
          </fieldset>
          <TextField name="medicationGiven" label="Medication given" hint="Name, dose and time" />
          <TextArea name="note" label="Note" rows={3} />
          <Checkbox name="share" label="Share this note with the customer" />
          <div>
            <SubmitButton>Save check</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      <Card aria-labelledby="history">
        <h2 id="history">Recent checks</h2>
        {history.checks.length === 0 ? <Muted>No checks yet.</Muted> : null}
        <ul className={s.list}>
          {history.checks.map((c) => (
            <li key={c.id} className={s.listItem} style={{ display: 'block' }}>
              <p>
                <strong>{formatUkDate(c.serviceDate)}</strong> · {ATE_LABELS[c.ate]} · {DRINKING_LABELS[c.drinking]} ·{' '}
                {TOILET_LABELS[c.toileting]} · {MOOD_LABELS[c.mood]}
                {c.medicationGiven ? ` · Medication: ${c.medicationGiven}` : ''}
              </p>
              {c.concerns.length ? (
                <p>
                  <StatusBadge tone="warning">{c.concerns.map((x) => CONCERN_LABELS[x]).join(', ')}</StatusBadge>
                </p>
              ) : null}
              {c.note ? <p style={{ whiteSpace: 'pre-wrap' }}>{c.note}</p> : null}
              <p className={s.hint}>
                {c.autoShared
                  ? 'Shared automatically (customer must be told)'
                  : c.shared
                    ? 'Shared with the customer'
                    : 'Only you'}
              </p>
              {c.autoShared ? null : (
                <ActionForm action={welfareShareAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="dogId" value={dogId} />
                  <input type="hidden" name="shared" value={c.shared ? '0' : '1'} />
                  <SubmitButton variant="ghost">
                    {c.shared ? 'Stop sharing' : 'Share with customer'}
                    <span className="visually-hidden"> – check on {formatUkDate(c.serviceDate)}</span>
                  </SubmitButton>
                </ActionForm>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
