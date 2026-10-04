import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, RadioGroup, SubmitButton, TextArea, TextField } from '@/ui/form';
import { saveVetAction } from '../../../actions';
import { loadDogPage } from '../load';

export const metadata: Metadata = { title: 'Vet details' };
export const dynamic = 'force-dynamic';

export default async function VetPage({ params }: { params: Promise<{ dogId: string }> }) {
  const { dog, vet, agreedVet } = await loadDogPage((await params).dogId);
  const choice = dog.agreedVetId ? (dog.agreedVetId === dog.vetId ? 'same' : 'other') : undefined;
  return (
    <Card>
      <Stack>
        <p className={s.breadcrumb}>
          <Link href={`/account/dogs/${dog.id}`}>{dog.name}</Link> › Vet details
        </p>
        <h1>{dog.name}’s vet</h1>
        <ActionForm action={saveVetAction}>
          <input type="hidden" name="dogId" value={dog.id} />
          <TextField name="practiceName" label="Practice name" required defaultValue={vet?.practiceName} />
          <TextField name="vetName" label="Vet’s name" defaultValue={vet?.vetName} />
          <TextField
            name="phone"
            label="Practice phone number"
            type="tel"
            inputMode="tel"
            required
            defaultValue={vet?.phone}
          />
          <TextArea name="address" label="Practice address" defaultValue={vet?.address} />
          <RadioGroup
            name="agreedVet"
            label="Which vet should we use in an emergency?"
            options={[
              { value: 'same', label: 'This practice' },
              { value: 'other', label: 'A different practice' },
            ]}
            defaultValue={choice}
          />
          <fieldset className={s.fieldset}>
            <legend className={s.label}>If a different practice</legend>
            <div className={s.stack}>
              <TextField
                name="agreedPracticeName"
                label="Emergency practice name"
                defaultValue={agreedVet?.practiceName}
              />
              <TextField
                name="agreedPhone"
                label="Emergency practice phone number"
                type="tel"
                inputMode="tel"
                defaultValue={agreedVet?.phone}
              />
              <TextArea name="agreedAddress" label="Emergency practice address" defaultValue={agreedVet?.address} />
            </div>
          </fieldset>
          <div>
            <SubmitButton>Save vet details</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
