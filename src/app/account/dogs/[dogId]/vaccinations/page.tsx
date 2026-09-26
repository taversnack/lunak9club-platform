import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, FieldError, FileField, SubmitButton, TextField } from '@/ui/form';
import { uploadVaccinationAction } from '../../../actions';
import { loadDogPage } from '../load';

export const metadata: Metadata = { title: 'Upload a vaccination record' };
export const dynamic = 'force-dynamic';

export default async function VaccinationsPage({ params }: { params: Promise<{ dogId: string }> }) {
  const { dog, evaluation } = await loadDogPage((await params).dogId);
  const vaccines = evaluation.items.filter((i) => i.kind === 'vaccination');
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
            <legend className={s.label}>
              Which vaccinations does this record show, and when are they valid until?
            </legend>
            <span className={s.hint}>
              Tick each one and enter the date it’s valid until (the “next due” date on the card).
            </span>
            <FieldError name="entries" />
            {vaccines.map((v) => (
              <div key={v.key} className={s.card} style={{ padding: 'var(--space-3)' }}>
                <label className={s.choice}>
                  <input type="checkbox" name="covers" value={v.key} />
                  <span>{v.label}</span>
                </label>
                <TextField name={`expiresOn.${v.key}`} label={`${v.label}: valid until`} type="date" required />
              </div>
            ))}
          </fieldset>
          <div>
            <SubmitButton pendingText="Uploading…">Upload record</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
