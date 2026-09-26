import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, Checkbox, RadioGroup, SelectField, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerBookableDogs } from '@/server/services/owner-bookings';
import { londonDate } from '@/domain/time';
import { ownerBookAction } from '../../actions';

export const metadata: Metadata = { title: 'Book a dog' };
export const dynamic = 'force-dynamic';

export default async function OwnerNewBooking() {
  const actor = await requirePermission('bookings.manage');
  const dogs = await ownerBookableDogs(getDb(), actor);
  return (
    <Card>
      <Stack>
        <p className={s.breadcrumb}>
          <Link href="/admin/bookings">Bookings</Link> › Book a dog
        </p>
        <h1>Book a dog</h1>
        <p>
          Use this for trial days, phone bookings and exceptions. If the dog isn’t approved, the day is closed or full,
          you’ll need to give a reason.
        </p>
        <ActionForm action={ownerBookAction}>
          <SelectField
            name="dogId"
            label="Dog"
            options={dogs.map((d) => ({
              value: d.id,
              label: `${d.name} (${d.customerName})${d.status === 'approved' ? '' : ' – not approved'}`,
            }))}
          />
          <TextField name="date" label="Date" type="date" required defaultValue={londonDate(new Date())} />
          <RadioGroup
            name="session"
            label="Session"
            defaultValue="full"
            options={[
              { value: 'full', label: 'Full day' },
              { value: 'am', label: 'Morning' },
              { value: 'pm', label: 'Afternoon' },
            ]}
          />
          <Checkbox name="taxi" label="Dog taxi" />
          <TextArea
            name="overrideReason"
            label="Reason for any override"
            hint="For example “Trial day” or “Agreed extra place”"
            rows={2}
          />
          <div>
            <SubmitButton>Book</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
