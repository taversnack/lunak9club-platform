import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Card, Muted, Stack } from '@/ui/components';
import { ActionForm, SubmitButton, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { listClosures } from '@/server/services/owner-bookings';
import { loadSettings } from '@/server/services/booking-shared';
import { formatUkDate, londonDate } from '@/domain/time';
import { addClosureAction, bookingSettingsAction, removeClosureAction } from '../../actions';

export const metadata: Metadata = { title: 'Opening and capacity' };
export const dynamic = 'force-dynamic';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default async function AvailabilityPage() {
  const actor = await requirePermission('availability.manage');
  const db = getDb();
  const [settings, closures] = await Promise.all([loadSettings(db), listClosures(db, actor, londonDate(new Date()))]);
  return (
    <Stack>
      <h1>Opening and capacity</h1>
      <Card aria-labelledby="settings">
        <h2 id="settings">Normal week</h2>
        <ActionForm action={bookingSettingsAction}>
          <fieldset className={s.fieldset}>
            <legend className={s.label}>Open on</legend>
            <div className={s.choices}>
              {DAYS.map((d, i) => (
                <label key={d} className={s.choice}>
                  <input
                    type="checkbox"
                    name="openWeekdays"
                    value={i + 1}
                    defaultChecked={settings.openWeekdays.includes(i + 1)}
                  />
                  <span>{d}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={s.two}>
            <TextField
              name="sessionCapacity"
              label="Dogs per session"
              inputMode="numeric"
              required
              defaultValue={settings.sessionCapacity}
            />
            <TextField
              name="taxiCapacity"
              label="Taxi places per day"
              inputMode="numeric"
              required
              defaultValue={settings.taxiCapacity}
            />
            <TextField name="fullDayStart" label="Full day starts" required defaultValue={settings.fullDayStart} />
            <TextField name="fullDayEnd" label="Full day ends" required defaultValue={settings.fullDayEnd} />
            <TextField name="morningStart" label="Morning starts" required defaultValue={settings.morningStart} />
            <TextField name="morningEnd" label="Morning ends" required defaultValue={settings.morningEnd} />
            <TextField name="afternoonStart" label="Afternoon starts" required defaultValue={settings.afternoonStart} />
            <TextField name="afternoonEnd" label="Afternoon ends" required defaultValue={settings.afternoonEnd} />
            <TextField
              name="maxAdvanceDays"
              label="How far ahead customers can book (days)"
              inputMode="numeric"
              required
              defaultValue={settings.maxAdvanceDays}
            />
            <TextField
              name="freeCancellationHours"
              label="Free cancellation up to (hours before)"
              inputMode="numeric"
              required
              defaultValue={settings.freeCancellationHours}
            />
            <TextField
              name="waitlistOfferHours"
              label="Hold waitlist offers for (hours)"
              inputMode="numeric"
              required
              defaultValue={settings.waitlistOfferHours}
            />
          </div>
          <div>
            <SubmitButton>Save settings</SubmitButton>
          </div>
        </ActionForm>
      </Card>
      <Card aria-labelledby="closures">
        <h2 id="closures">Closures</h2>
        <p className={s.hint}>England and Wales bank holidays are already included.</p>
        {closures.length === 0 ? (
          <Muted>No upcoming closures.</Muted>
        ) : (
          <ul className={s.list}>
            {closures.map((c) => (
              <li key={c.serviceDate} className={s.listItem}>
                <span>
                  {formatUkDate(c.serviceDate)} – {c.reason}
                </span>
                <ActionForm action={removeClosureAction}>
                  <input type="hidden" name="date" value={c.serviceDate} />
                  <SubmitButton variant="secondary">
                    Remove <span className="visually-hidden">{c.reason}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <h3>Add a closure</h3>
        <ActionForm action={addClosureAction}>
          <TextField name="date" label="Date" type="date" required />
          <TextField name="reason" label="Reason" required hint="Customers see this on the booking calendar" />
          <div>
            <SubmitButton variant="secondary">Add closure</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </Stack>
  );
}
