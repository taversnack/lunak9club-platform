import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { DogDetailsFields } from '../../dog-details-fields';
import { updateDogAction } from '../../../actions';
import { loadDogPage } from '../load';

export const metadata: Metadata = { title: 'Edit dog details' };
export const dynamic = 'force-dynamic';

export default async function EditDogPage({ params }: { params: Promise<{ dogId: string }> }) {
  const { dog } = await loadDogPage((await params).dogId);
  return (
    <Card>
      <Stack>
        <p className={s.breadcrumb}>
          <Link href={`/account/dogs/${dog.id}`}>{dog.name}</Link> › Edit details
        </p>
        <h1>Edit {dog.name}’s details</h1>
        <ActionForm action={updateDogAction}>
          <input type="hidden" name="dogId" value={dog.id} />
          <DogDetailsFields dog={dog} />
          <div>
            <SubmitButton>Save details</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
