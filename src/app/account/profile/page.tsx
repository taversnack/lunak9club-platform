import type { Metadata } from 'next';
import { Card, Stack } from '@/ui/components';
import { ActionForm, SubmitButton, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { getMyCustomer } from '@/server/services/customers';
import { saveProfileAction } from '../actions';

export const metadata: Metadata = { title: 'Your details' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const actor = await requirePermission('account.access');
  const c = await getMyCustomer(getDb(), actor);
  return (
    <Card>
      <Stack>
        <h1>Your details</h1>
        <p>We use these to contact you and, if you use the dog taxi, to collect and drop off your dog.</p>
        <ActionForm action={saveProfileAction}>
          <TextField
            name="phone"
            label="Mobile phone number"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            defaultValue={c.phone}
          />
          <TextField
            name="addressLine1"
            label="Address line 1"
            autoComplete="address-line1"
            required
            defaultValue={c.addressLine1}
          />
          <TextField
            name="addressLine2"
            label="Address line 2"
            autoComplete="address-line2"
            defaultValue={c.addressLine2}
          />
          <TextField name="town" label="Town or city" autoComplete="address-level2" required defaultValue={c.town} />
          <TextField name="postcode" label="Postcode" autoComplete="postal-code" required defaultValue={c.postcode} />
          <div>
            <SubmitButton>Save details</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
