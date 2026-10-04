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
          or kennel cough isn’t up to date, you’ll need to give a reason.
        </p>
        <p className={s.hint}>
          A reason can’t override licence rules, even for a trial day: core and leptospirosis vaccinations must be on an
          accepted, up-to-date record, and a first course of vaccinations must have finished at least 14 days before.
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
          <Checkbox name="trial" label="This is a trial day" />
          <RadioGroup
            name="trialBand"
            label="If it’s a trial day, charge at"
            defaultValue="ad_hoc"
            options={[
              { value: 'ad_hoc', label: 'Ad hoc rate' },
              { value: 'low', label: '1–3 days a week rate' },
              { value: 'high', label: '4–5 days a week rate' },
            ]}
          />
          <TextArea
            name="overrideReason"
            label="Reason for any override"
            hint="For example “Trial day” or “Agreed extra place”"
            rows={2}
          />
          <p className={s.hint}>
            If the day has a price, the customer is emailed a card payment link and the place is held for up to 24 hours
            (or until the session starts). Unpaid places are released automatically.
          </p>
          <div>
            <SubmitButton>Book</SubmitButton>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
