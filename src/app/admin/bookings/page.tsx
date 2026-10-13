import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { checksForDay } from '@/server/services/welfare';
import { formatDateTimeLondon } from '@/ui/format';
import { Alert, buttonClass, Card, Grid, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, Checkbox, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerDay } from '@/server/services/owner-bookings';
import { SESSION_LABELS } from '@/domain/booking/rules';
import { addDays, formatUkDate, isIsoDate, londonDate } from '@/domain/time';
import {
  attendanceAction,
  dayCapacityAction,
  internalNoteAction,
  offerPlaceAction,
  ownerCancelAction,
} from '../actions';

export const metadata: Metadata = { title: 'Bookings – day' };
export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'info' | 'success' | 'warning' | 'danger'; text: string }> = {
  confirmed: { tone: 'info', text: 'Expected' },
  pending_payment: { tone: 'warning', text: 'Awaiting payment' },
  attended: { tone: 'success', text: 'Checked in' },
  no_show: { tone: 'danger', text: 'No-show' },
  offered: { tone: 'warning', text: 'Offer held' },
  waitlisted: { tone: 'info', text: 'Waiting' },
  cancelled: { tone: 'info', text: 'Cancelled' },
};
const time = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', timeStyle: 'short' }).format(d) : '';

function Op({
  id,
  version,
  op,
  label,
  variant = 'secondary',
  dog,
}: {
  id: string;
  version: number;
  op: string;
  label: string;
  variant?: 'primary' | 'secondary';
  dog: string;
}) {
  return (
    <ActionForm action={attendanceAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="op" value={op} />
      <SubmitButton variant={variant}>
        {label} <span className="visually-hidden">{dog}</span>
      </SubmitButton>
    </ActionForm>
  );
}

export default async function DayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const actor = await requirePermission('bookings.manage');
  const sp = await searchParams;
  const today = londonDate(new Date());
  const date = sp.date && isIsoDate(sp.date) ? sp.date : today;
  const [day, checks] = await Promise.all([ownerDay(getDb(), actor, date), checksForDay(getDb(), actor, date)]);
  return (
    <Stack>
      <div className={s.row}>
        <h1>{formatUkDate(date)}</h1>
        <Link href="/admin/bookings/new" className={buttonClass('primary')}>
          Book a dog
        </Link>
      </div>
      <nav aria-label="Dates" className={s.row} style={{ justifyContent: 'flex-start' }}>
        <Link href={`/admin/bookings?date=${addDays(date, -1)}`}>‹ Previous day</Link>
        <Link href={`/admin/bookings?date=${today}`}>Today</Link>
        <Link href={`/admin/bookings?date=${addDays(date, 1)}`}>Next day ›</Link>
        <Link href={`/admin/bookings/week?from=${date}`}>Week view</Link>
        <Link href={`/admin/bookings/month?month=${date.slice(0, 7)}`}>Month view</Link>
        <form method="get" className={s.row} style={{ gap: 'var(--space-2)' }}>
          <label htmlFor="jump" className="visually-hidden">
            Go to date
          </label>
          <input id="jump" type="date" name="date" defaultValue={date} className={s.input} />
          <button className={`${s.button} ${s.ghost}`} type="submit">
            Go
          </button>
        </form>
      </nav>
      {day.closedReason ? (
        <Alert tone="info" title="Closed">
          {day.closedReason}
        </Alert>
      ) : null}
      <Grid>
        <Card aria-labelledby="am">
          <h2 id="am">Morning</h2>
          <p className={s.bigNumber}>
            {day.used.am} / {day.capacity.session}
          </p>
          <span className={s.hint}>{day.left.am} places left</span>
        </Card>
        <Card aria-labelledby="pm">
          <h2 id="pm">Afternoon</h2>
          <p className={s.bigNumber}>
            {day.used.pm} / {day.capacity.session}
          </p>
          <span className={s.hint}>{day.left.pm} places left</span>
        </Card>
        <Card aria-labelledby="taxi-count">
          <h2 id="taxi-count">Taxi</h2>
          <p className={s.bigNumber}>
            {day.used.taxi} / {day.capacity.taxi}
          </p>
          <span className={s.hint}>{day.waitlist.length} on the waitlist</span>
        </Card>
      </Grid>
      <p>
        Download: <a href={`/api/admin/exports/attendance?date=${date}`}>attendance list (CSV)</a> ·{' '}
        <a href={`/api/admin/exports/emergency?date=${date}`}>emergency contacts (CSV)</a>
      </p>

      <Card aria-labelledby="dogs">
        <h2 id="dogs">Dogs ({day.booked.length})</h2>
        {day.booked.length === 0 ? <Muted>No dogs booked.</Muted> : null}
        <ul className={s.list}>
          {day.booked.map((r) => (
            <li key={r.id} className={s.listItem} style={{ display: 'block' }}>
              <div className={s.row}>
                <div>
                  <Link href={`/admin/dogs/${r.dogId}`}>
                    <strong>{r.dogName}</strong>
                  </Link>{' '}
                  · {SESSION_LABELS[r.session]}
                  {r.taxi ? ' · taxi' : ''}
                  <div className={s.hint}>
                    {r.customerName} · {r.customerPhone ?? 'no phone'}
                  </div>
                </div>
                <StatusBadge tone={STATUS[r.status]!.tone}>
                  {STATUS[r.status]!.text}
                  {r.checkedInAt ? ` ${time(r.checkedInAt)}` : ''}
                  {r.checkedOutAt ? ` – out ${time(r.checkedOutAt)}` : ''}
                </StatusBadge>
              </div>
              {r.status === 'confirmed' && r.checkInBlocked ? (
                <Alert tone="danger" title="Can’t be checked in">
                  {r.checkInBlocked} Licence rules don’t allow an override.
                </Alert>
              ) : r.warning ? (
                <Alert tone="warning">{r.warning}</Alert>
              ) : null}
              {r.status === 'pending_payment' && r.offerExpiresAt ? (
                <p className={s.hint}>Payment link sent – held until {formatDateTimeLondon(r.offerExpiresAt)}.</p>
              ) : null}
              {r.overrideReason ? <p className={s.hint}>Override: {r.overrideReason}</p> : null}
              {r.customerNote ? <p className={s.hint}>Customer note: {r.customerNote}</p> : null}
              <div className={s.row} style={{ justifyContent: 'flex-start' }}>
                {r.status === 'confirmed' ? (
                  <>
                    {r.checkInBlocked ? null : r.checkInNeedsReason ? (
                      <ActionForm action={attendanceAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="version" value={r.version} />
                        <input type="hidden" name="op" value="checkIn" />
                        <TextField
                          name="overrideReason"
                          label={`Reason for checking ${r.dogName} in anyway`}
                          hint="Only kennel cough can be overridden"
                          required
                        />
                        <div>
                          <SubmitButton>
                            Check in <span className="visually-hidden">{r.dogName}</span>
                          </SubmitButton>
                        </div>
                      </ActionForm>
                    ) : (
                      <Op
                        id={r.id}
                        version={r.version}
                        op="checkIn"
                        label="Check in"
                        variant="primary"
                        dog={r.dogName}
                      />
                    )}
                    <Op id={r.id} version={r.version} op="markNoShow" label="No-show" dog={r.dogName} />
                  </>
                ) : null}
                {r.status === 'attended' && !r.checkedOutAt ? (
                  <Op id={r.id} version={r.version} op="checkOut" label="Check out" variant="primary" dog={r.dogName} />
                ) : null}
                {r.status === 'attended' || r.status === 'no_show' ? (
                  <Op id={r.id} version={r.version} op="undoAttendance" label="Undo" dog={r.dogName} />
                ) : null}
              </div>
              {r.status === 'attended' || r.status === 'confirmed' ? (
                <p className={s.hint}>
                  <Link href={`/admin/dogs/${r.dogId}/check?date=${date}&bookingDog=${r.id}`}>
                    Daily check <span className="visually-hidden">for {r.dogName}</span>
                  </Link>
                  {checks.get(r.dogId) ? ` (${checks.get(r.dogId)} done)` : ''} ·{' '}
                  <Link href={`/admin/incidents/new?dogId=${r.dogId}&date=${date}&bookingDog=${r.id}`}>
                    Report an incident <span className="visually-hidden">for {r.dogName}</span>
                  </Link>
                </p>
              ) : null}
              <details>
                <summary>Notes and cancellation</summary>
                <ActionForm action={internalNoteAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="version" value={r.version} />
                  <TextArea
                    name="internalNote"
                    label="Internal note (only you can see this)"
                    rows={2}
                    defaultValue={r.internalNote}
                  />
                  <div>
                    <SubmitButton variant="secondary">Save note</SubmitButton>
                  </div>
                </ActionForm>
                {r.status === 'confirmed' || r.status === 'offered' || r.status === 'pending_payment' ? (
                  <ActionForm action={ownerCancelAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="version" value={r.version} />
                    <TextField name="reason" label="Reason for cancelling" required />
                    <Checkbox name="charge" label="Still charge for this day" />
                    <div>
                      <SubmitButton variant="danger">Cancel booking</SubmitButton>
                    </div>
                  </ActionForm>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="taxi">
        <h2 id="taxi">Taxi run ({day.taxi.length})</h2>
        {day.taxi.length === 0 ? (
          <Muted>No taxi bookings.</Muted>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Taxi run" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Dog</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Address</th>
                  <th scope="col">Session</th>
                </tr>
              </thead>
              <tbody>
                {day.taxi.map((r) => (
                  <tr key={r.id}>
                    <td>{r.dogName}</td>
                    <td>
                      {r.customerName} · {r.customerPhone}
                    </td>
                    <td>{[r.addressLine1, r.town, r.postcode].filter(Boolean).join(', ')}</td>
                    <td>{SESSION_LABELS[r.session]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card aria-labelledby="waitlist">
        <h2 id="waitlist">Waitlist ({day.waitlist.length})</h2>
        {day.waitlist.length === 0 ? (
          <Muted>Nobody waiting.</Muted>
        ) : (
          <ul className={s.list}>
            {day.waitlist.map((r) => (
              <li key={r.id} className={s.listItem}>
                <span>
                  <strong>{r.dogName}</strong> · {SESSION_LABELS[r.session]}
                  {r.taxi ? ' · taxi' : ''} · {r.customerName}
                  {r.status === 'offered' ? <span className={s.hint}> (last offer lapsed)</span> : null}
                  {r.warning ? <span className={s.hint}> · {r.warning}</span> : null}
                </span>
                <ActionForm action={offerPlaceAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="version" value={r.version} />
                  <SubmitButton variant="secondary">
                    Offer place <span className="visually-hidden">{r.dogName}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card aria-labelledby="capacity">
        <h2 id="capacity">Capacity for this day</h2>
        <ActionForm action={dayCapacityAction}>
          <input type="hidden" name="date" value={date} />
          <TextField
            name="sessionCapacity"
            label="Places per session"
            inputMode="numeric"
            required
            defaultValue={day.capacity.session}
          />
          <TextField
            name="taxiCapacity"
            label="Taxi places"
            inputMode="numeric"
            required
            defaultValue={day.capacity.taxi}
          />
          <TextField name="note" label="Note (for example “one member of staff off”)" />
          <div>
            <SubmitButton variant="secondary">Update capacity</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {day.cancelled.length ? (
        <Card aria-labelledby="cancelled">
          <h2 id="cancelled">Cancelled ({day.cancelled.length})</h2>
          <ul>
            {day.cancelled.map((r) => (
              <li key={r.id}>
                {r.dogName} · {SESSION_LABELS[r.session]} · {r.customerName}
                {r.lateCancellation ? ' · late – charged' : ''}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </Stack>
  );
}
