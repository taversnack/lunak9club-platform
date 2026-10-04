import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, FieldError, FileField, RadioGroup, SubmitButton, TextField } from '@/ui/form';
import { uploadVaccinationAction } from '../../../actions';
import { loadDogPage } from '../load';
import { londonDate } from '@/domain/time';

export const metadata: Metadata = { title: 'Upload a vaccination record' };
export const dynamic = 'force-dynamic';

export default async function VaccinationsPage({ params }: { params: Promise<{ dogId: string }> }) {
  const { dog, evaluation } = await loadDogPage((await params).dogId);
  const vaccines = evaluation.items.filter((i) => i.kind === 'vaccination');
  const today = londonDate(new Date());
  return (
    <Card>
      <Stack>
        <p className={s.breadcrumb}>
          <Link href={`/account/dogs/${dog.id}`}>{dog.name}</Link> › Upload a vaccination record
        </p>
        <h1>Upload a vaccination record</h1>
        <p>
          A clear photo of the vaccination card or a PDF from your vet is fine. One record can cover several
          vaccinations.
        </p>
        <ActionForm action={uploadVaccinationAction} encType="multipart/form-data">
          <input type="hidden" name="dogId" value={dog.id} />
          <FileField
            name="file"
            label="Vaccination record"
            hint="PDF, JPEG, PNG, WEBP or HEIC, up to 10 MB"
            accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
          />
          <fieldset className={s.fieldset}>
            <legend className={s.label}>Which vaccinations does this record show?</legend>
            <span className={s.hint}>
              Tick each one and enter the date it was given and the date it’s valid until (the “next due” date on the
              card).
            </span>
            <FieldError name="entries" />
            {vaccines.map((v) => (
              <div key={v.key} className={s.card} style={{ padding: 'var(--space-3)' }}>
                <label className={s.choice}>
                  <input type="checkbox" name="covers" value={v.key} />
                  <span>{v.label}</span>
                </label>
                <TextField
                  name={`administeredOn.${v.key}`}
                  label={`${v.label}: date given`}
                  type="date"
                  required
                  max={today}
                />
                <TextField name={`expiresOn.${v.key}`} label={`${v.label}: valid until`} type="date" required />
              </div>
            ))}
          </fieldset>
          <RadioGroup
            name="firstCourse"
            label="Is this your dog’s first course of vaccinations?"
            hint="For example a puppy’s first injections, or a dog that has never been vaccinated before."
            options={[
              { value: 'no', label: 'No' },
              { value: 'yes', label: 'Yes' },
            ]}
          />
          <TextField
            name="primaryCourseCompletedOn"
            label="If yes, the date the first course finished"
            hint="The date of the last injection in the course. Your dog can start day care 14 days after this date."
            type="date"
          />
          <div>
            <SubmitButton pendingText="Uploading…">Upload record</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
