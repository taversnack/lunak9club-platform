import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, Checkbox, RadioGroup, SubmitButton, TextField } from '@/ui/form';
import { DayPicker, SESSION_OPTIONS } from '@/ui/day-picker';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { loadSettings } from '@/server/services/booking-shared';
import { addDays, londonDate } from '@/domain/time';
import { createCustomerAction } from '../actions';

export const metadata: Metadata = { title: 'New customer' };
export const dynamic = 'force-dynamic';

/** D86: the Owner creates the account and, if days were agreed and there's space, sets each dog's days. */
export default async function NewCustomerPage() {
  await requirePermission('users.manage');
  const settings = await loadSettings(getDb());
  const tomorrow = addDays(londonDate(new Date()), 1);
  return (
    <Stack>
      <p className={s.breadcrumb}>
        <Link href="/admin/customers">Customers</Link> › New customer
      </p>
      <h1>New customer</h1>
      <p>
        We’ll email the customer a link to finish signing up (it works once and expires in 7 days). If you agreed their
        dog’s days, set them here; otherwise leave the days blank and they’ll choose them while setting up. Days are
        only accepted where there’s space.
      </p>
      <ActionForm action={createCustomerAction}>
        <Card aria-labelledby="who">
          <h2 id="who">Customer</h2>
          <TextField name="name" label="Full name" required autoComplete="off" />
          <TextField name="email" label="Email address" type="email" required autoComplete="off" />
        </Card>
        {[0, 1, 2].map((i) => (
          <Card key={i} aria-labelledby={`dog-${i}`}>
            <h2 id={`dog-${i}`}>{i === 0 ? 'Dog' : `Another dog (optional)`}</h2>
            <TextField
              name={`dogs.${i}.dogName`}
              label="Dog’s name"
              required={i === 0}
              hint={i === 0 ? undefined : 'Leave blank if there isn’t another dog.'}
            />
            <DayPicker name={`dogs.${i}.weekdays`} open={settings.openWeekdays} legend="Agreed days (optional)" />
            <RadioGroup name={`dogs.${i}.session`} label="Session" options={SESSION_OPTIONS} defaultValue="full" />
            <Checkbox name={`dogs.${i}.taxi`} label="Uses the dog taxi" />
            <TextField
              name={`dogs.${i}.startsOn`}
              label="First day (if days are set)"
              type="date"
              required={false}
              min={tomorrow}
            />
          </Card>
        ))}
        <div>
          <SubmitButton pendingText="Creating…">Create account and send invite</SubmitButton>
        </div>
      </ActionForm>
    </Stack>
  );
}
