import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, Checkbox, FileField, RadioGroup, SelectField, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerBookableDogs } from '@/server/services/owner-bookings';
import { londonDate, londonTime } from '@/domain/time';
import { INCIDENT_KIND_LABELS, SEVERITY_LABELS } from '@/ui/welfare-labels';
import { reportIncidentAction } from '../../actions';

export const metadata: Metadata = { title: 'Report an incident' };
export const dynamic = 'force-dynamic';

export default async function NewIncidentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('incidents.manage');
  const dogList = await ownerBookableDogs(getDb(), actor);
  const now = new Date();
  return (
    <Stack>
      <p>
        <Link href="/admin/incidents">← Incidents</Link>
      </p>
      <h1>Report an incident</h1>
      <p className={s.hint}>
        The customer is emailed as soon as you save, and can read “What happened”, “What we did” and the vet’s advice in
        their account. Internal notes are never shown to them. The report can’t be edited afterwards – add an update
        instead.
      </p>
      <Card>
        <ActionForm action={reportIncidentAction} encType="multipart/form-data">
          {sp.bookingDog ? <input type="hidden" name="bookingDogId" value={sp.bookingDog} /> : null}
          <SelectField
            name="dogId"
            label="Dog"
            defaultValue={sp.dogId}
            options={[
              { value: '', label: 'Choose a dog' },
              ...dogList.map((d) => ({ value: d.id, label: `${d.name} (${d.customerName})` })),
            ]}
          />
          <div className={s.two}>
            <TextField name="occurredOn" label="Date" type="date" defaultValue={sp.date ?? londonDate(now)} required />
            <TextField name="occurredTime" label="Time (24-hour)" defaultValue={londonTime(now)} required />
          </div>
          <RadioGroup
            name="kind"
            label="What kind of incident?"
            options={Object.entries(INCIDENT_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <RadioGroup
            name="severity"
            label="How serious?"
            options={Object.entries(SEVERITY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <TextArea name="description" label="What happened (the customer sees this)" rows={4} required />
          <TextArea name="actionTaken" label="What we did (the customer sees this)" rows={3} required />
          <Checkbox name="vetContacted" label="A vet was contacted" />
          <TextArea name="vetAdvice" label="What the vet advised (if contacted)" rows={2} />
          <TextField name="followUpDue" label="Check back on" type="date" hint="Optional reminder for you" />
          <TextArea name="internalNotes" label="Internal notes (only you see these)" rows={2} />
          <FileField
            name="photos"
            label="Photos"
            hint="Up to 5 photos or PDFs, 10 MB each. The customer can see them."
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            multiple
            required={false}
          />
          <div>
            <SubmitButton pendingText="Saving…">Save and tell the customer</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </Stack>
  );
}
