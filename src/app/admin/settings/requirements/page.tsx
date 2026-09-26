import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, Checkbox, SubmitButton, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { listRequirements } from '@/server/services/owner-review';
import { getDb } from '@/infra/db/client';
import { updateRequirementAction } from '../../actions';

export const metadata: Metadata = { title: 'Onboarding requirements' };
export const dynamic = 'force-dynamic';

export default async function RequirementsPage() {
  const actor = await requirePermission('requirements.manage');
  const reqs = await listRequirements(getDb(), actor);
  return (
    <Stack>
      <h1>Onboarding requirements</h1>
      <p>Choose what every dog needs before they can book. Changes apply straight away to all dogs.</p>
      {reqs.map((r) => (
        <Card key={r.key} aria-labelledby={`r-${r.key}`}>
          <h2 id={`r-${r.key}`}>{r.label}</h2>
          <p className={s.muted}>{r.description}</p>
          <ActionForm action={updateRequirementAction}>
            <input type="hidden" name="key" value={r.key} />
            <Checkbox name="active" label="In use" defaultChecked={r.active} />
            <Checkbox name="mandatory" label="Required before a dog can be approved" defaultChecked={r.mandatory} />
            <Checkbox
              name="blocksBooking"
              label="Block bookings if missing or expired"
              defaultChecked={r.blocksBooking}
            />
            {r.kind === 'vaccination' ? (
              <TextField
                name="reminderDays"
                label="Reminder days before expiry"
                hint="Comma separated, for example 30, 14, 7"
                required
                defaultValue={r.reminderDays.join(', ')}
              />
            ) : (
              <input type="hidden" name="reminderDays" value={r.reminderDays.join(',')} />
            )}
            <div>
              <SubmitButton variant="secondary">
                Save <span className="visually-hidden">{r.label}</span>
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ))}
    </Stack>
  );
}
