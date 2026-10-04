import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, Checkbox, RadioGroup, SelectField, SubmitButton, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myMemberships, describeWeekdays } from '@/server/services/memberships';
import { myBookableDogs } from '@/server/services/bookings';
import { loadSettings } from '@/server/services/booking-shared';
import { formatPounds, SESSION_LABELS, type Session } from '@/domain/booking/rules';
import { addDays, formatUkDate, londonDate } from '@/domain/time';
import { leaveMembershipAction, requestMembershipAction, withdrawMembershipAction } from '../actions';

export const metadata: Metadata = { title: 'Membership' };
export const dynamic = 'force-dynamic';

const DAYS = [
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
  { value: '7', label: 'Sunday' },
];
const STATUS: Record<string, { tone: 'info' | 'success' | 'warning' | 'danger'; text: string }> = {
  requested: { tone: 'info', text: 'Waiting for Luna’s K9 Club' },
  active: { tone: 'success', text: 'Active' },
  declined: { tone: 'danger', text: 'Not accepted' },
  ended: { tone: 'info', text: 'Ended' },
  withdrawn: { tone: 'info', text: 'Withdrawn' },
};

function DayPicker({ open }: { open: readonly number[] }) {
  return (
    <fieldset className={s.fieldset}>
      <legend className={s.label}>Which days each week?</legend>
      <div className={s.choices}>
        {DAYS.filter((d) => open.includes(Number(d.value))).map((d) => (
          <label key={d.value} className={s.choice}>
            <input type="checkbox" name="weekdays" value={d.value} />
            <span>{d.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const sessionOptions = [
  { value: 'full', label: 'Full day' },
  { value: 'am', label: 'Morning' },
  { value: 'pm', label: 'Afternoon' },
];

export default async function MembershipPage() {
  const actor = await requirePermission('account.access');
  const db = getDb();
  const [{ book, memberships, changeFrom }, dogs, settings] = await Promise.all([
    myMemberships(db, actor),
    myBookableDogs(db, actor),
    loadSettings(db),
  ]);
  const tomorrow = addDays(londonDate(new Date()), 1);
  const eligible = dogs.filter(
    (d) => d.canBook && !memberships.some((m) => m.dogId === d.id && ['requested', 'active'].includes(m.status)),
  );
  return (
    <Stack>
      <h1>Membership</h1>
      {memberships.some((m) => m.status === 'requested') ? (
        <Alert tone="info" title="Request received">
          Thanks – we’ll review your membership request and email you.
        </Alert>
      ) : null}
      {book ? (
        <Card aria-labelledby="prices">
          <h2 id="prices">Prices per dog per day</h2>
          <div className={s.tableWrap} role="region" aria-label="Prices" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Full day</th>
                  <th scope="col">Half day</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Ad hoc (no membership)</td>
                  <td>{formatPounds(book.adHocFullPence)}</td>
                  <td>{formatPounds(Math.floor((book.adHocFullPence * book.halfDayPercent + 50) / 100))}</td>
                </tr>
                <tr>
                  <td>1–{book.memberHighFromDays - 1} days a week</td>
                  <td>{formatPounds(book.memberLowFullPence)}</td>
                  <td>{formatPounds(Math.floor((book.memberLowFullPence * book.halfDayPercent + 50) / 100))}</td>
                </tr>
                <tr>
                  <td>{book.memberHighFromDays}–5 days a week</td>
                  <td>{formatPounds(book.memberHighFullPence)}</td>
                  <td>{formatPounds(Math.floor((book.memberHighFullPence * book.halfDayPercent + 50) / 100))}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={s.hint}>
            The dog taxi is included. Members pay their member rate for extra days too. Memberships are invoiced monthly
            in advance.
          </p>
        </Card>
      ) : null}

      <Card aria-labelledby="yours">
        <h2 id="yours">Your memberships</h2>
        {memberships.length === 0 ? <Muted>No memberships yet.</Muted> : null}
        <ul className={s.list}>
          {memberships.map((m) => (
            <li key={m.id} className={s.listItem} style={{ display: 'block' }}>
              <div className={s.row}>
                <div>
                  <strong>{m.dogName}</strong> · {describeWeekdays(m.weekdays)} · {SESSION_LABELS[m.session as Session]}
                  {m.taxi ? ' · taxi' : ''}
                  <div className={s.hint}>
                    From {formatUkDate(m.startsOn)}
                    {m.endsOn ? ` to ${formatUkDate(m.endsOn)}` : ''}
                    {m.dayPrice && m.status !== 'declined'
                      ? ` · ${formatPounds(m.session === 'full' ? m.dayPrice : Math.floor((m.dayPrice * 50 + 50) / 100))} a day`
                      : ''}
                  </div>
                  {m.declineReason ? <div className={s.hint}>Reason: {m.declineReason}</div> : null}
                </div>
                <StatusBadge tone={STATUS[m.status]!.tone}>{STATUS[m.status]!.text}</StatusBadge>
              </div>
              {m.status === 'requested' ? (
                <ActionForm action={withdrawMembershipAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton variant="secondary">
                    Withdraw request <span className="visually-hidden">for {m.dogName}</span>
                  </SubmitButton>
                </ActionForm>
              ) : null}
              {m.status === 'active' && !m.endsOn ? (
                <details>
                  <summary>Change days or leave</summary>
                  <Stack>
                    <p>
                      Changes and leaving take effect from {formatUkDate(changeFrom)} (the 1st of next month if you ask
                      by the 20th).
                    </p>
                    <ActionForm action={requestMembershipAction}>
                      <input type="hidden" name="changeOf" value={m.id} />
                      <input type="hidden" name="dogId" value={m.dogId} />
                      <input type="hidden" name="startsOn" value={changeFrom} />
                      <DayPicker open={settings.openWeekdays} />
                      <RadioGroup name="session" label="Session" options={sessionOptions} defaultValue={m.session} />
                      <Checkbox name="taxi" label="Use the dog taxi" defaultChecked={m.taxi} />
                      <div>
                        <SubmitButton variant="secondary">Ask to change days</SubmitButton>
                      </div>
                    </ActionForm>
                    <ActionForm action={leaveMembershipAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <Checkbox
                        name="confirm"
                        label={`End ${m.dogName}’s membership (last day ${formatUkDate(addDays(changeFrom, -1))})`}
                      />
                      <div>
                        <SubmitButton variant="danger">End membership</SubmitButton>
                      </div>
                    </ActionForm>
                  </Stack>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card aria-labelledby="join">
        <h2 id="join">Become a member</h2>
        {eligible.length === 0 ? (
          <Alert tone="info">
            Memberships are available once your dog is approved, and each dog can have one membership.
          </Alert>
        ) : (
          <ActionForm action={requestMembershipAction}>
            <SelectField
              name="dogId"
              label="Dog"
              options={eligible.map((d) => ({ value: d.id, label: d.name }))}
              defaultValue={eligible.length === 1 ? eligible[0]!.id : undefined}
            />
            <DayPicker open={settings.openWeekdays} />
            <RadioGroup name="session" label="Session" options={sessionOptions} defaultValue="full" />
            <Checkbox name="taxi" label="Use the dog taxi (included)" />
            <TextField name="startsOn" label="Start date" type="date" required defaultValue={tomorrow} min={tomorrow} />
            <div>
              <SubmitButton>Ask to join</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Card>
    </Stack>
  );
}
