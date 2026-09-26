import type { Metadata } from 'next';
import { Card, Stack } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { DogDetailsFields } from '../dog-details-fields';
import { createDogAction } from '../../actions';

export const metadata: Metadata = { title: 'Add a dog' };

export default function NewDogPage() {
  return (
    <Card>
      <Stack>
        <h1>Add a dog</h1>
        <p>Start with the basics. Next you’ll add their vet, health and behaviour details and vaccination record.</p>
        <ActionForm action={createDogAction}>
          <DogDetailsFields />
          <div>
            <SubmitButton>Save and continue</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
