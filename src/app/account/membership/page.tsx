import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, Checkbox, SelectField, SubmitButton, TextField } from '@/ui/form';
import { DayPicker } from '@/ui/day-picker';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { describeWeekdays, myMemberships } from '@/server/services/memberships';
import { myMembershipDays, myMonthConfirmations } from '@/server/services/membership-workflow';
import { myApprovalRequests } from '@/server/services/approvals';
import { loadSettings } from '@/server/services/booking-shared';
import { formatPounds, SESSION_LABELS, type Session } from '@/domain/booking/rules';
import { addDays, formatUkDate, londonDate } from '@/domain/time';
import { changeEffectiveDate } from '@/domain/membership/rules';
import {
  confirmMonthAction,
  confirmOfferAction,
  leaveMembershipAction,
  requestMembershipDaysAction,
  withdrawMembershipAction,
} from '../actions';

export const metadata: Metadata = { title: 'Membership' };
export const dynamic = 'force-dynamic';

const OUTCOME: Record<string, { tone: 'info' | 'success' | 'warning' | 'danger'; text: string }> = {
  pending: { tone: 'info', text: 'Waiting for Luna’s K9 Club' },
  approved: { tone: 'success', text: 'Approved' },
  rejected: { tone: 'danger', text: 'Not approved' },
  withdrawn: { tone: 'info', text: 'Withdrawn' },
  expired: { tone: 'info', text: 'No longer open' },
};

const plan = (weekdays: number[], session: string, taxi: boolean) =>
  `${describeWeekdays(weekdays)} · ${SESSION_LABELS[session as Session]}${taxi ? ' · taxi' : ''}`;

export default async function MembershipPage() {
  const actor = await requirePermission('account.access');
  const db = getDb();
  const [days, months, requests, legacy, settings] = await Promise.all([
    myMembershipDays(db, actor),
    myMonthConfirmations(db, actor),
    myApprovalRequests(db, actor, { status: 'all' }),
    myMemberships(db, actor),
    loadSettings(db),
  ]);
  const { book } = legacy;
  const today = londonDate(new Date());
  const tomorrow = addDays(today, 1);
  const leaveFrom = changeEffectiveDate(today);
  const memberRequests = requests.filter((r) => r.type.startsWith('membership.')).slice(0, 20);
  const pendingFor = (dogId: string) =>
    memberRequests.find((r) => r.status === 'pending' && r.subjectKey === `dog:${dogId}`);
  const dogsFree = days.dogs.filter((d) => !d.membership);
  const legacyRequests = legacy.memberships.filter((m) => m.status === 'requested');

  return (
    <Stack>
      <h1>Membership</h1>
      <p>
        Questions about cancelling, changing or adding days? See <Link href="/account/faq">membership questions</Link>.
      </p>

      {months.length ? (
        <Card aria-labelledby="confirm">
          <h2 id="confirm">Confirm your days</h2>
          <ul className={s.list}>
            {months.map((m) => (
              <li key={m.month} className={s.listItem}>
                <div>
                  <strong>{m.monthText}</strong>
                  <div className={s.hint}>
                    {m.confirmedAt
                      ? `Confirmed${m.byOwner ? ' by Luna’s K9 Club' : ''}${m.late ? `, after ${formatUkDate(m.by)}` : ''}.`
                      : `Please confirm by ${formatUkDate(m.by)}. If you don’t, your days stay as they are.`}
                  </div>
                </div>
                {m.confirmedAt ? (
                  <StatusBadge tone={m.late ? 'warning' : 'success'}>
                    {m.late ? 'Confirmed late' : 'Confirmed'}
                  </StatusBadge>
                ) : (
                  <ActionForm action={confirmMonthAction}>
                    <input type="hidden" name="month" value={m.month} />
                    <SubmitButton>
                      Confirm days <span className="visually-hidden">for {m.monthText}</span>
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          <p className={s.hint}>
            Your booked days are in <Link href="/account/bookings">Your bookings</Link>, where you can also move a day.
          </p>
        </Card>
      ) : null}

      {days.offers.length ? (
        <Card aria-labelledby="offers">
          <h2 id="offers">Days we’ve set up for you</h2>
          <p>Please check these days. Confirm them, or ask for different days – any change comes to us to approve.</p>
          {dogsFree.length === 0 ? (
            <Alert tone="info">
              Add your dog first (<Link href="/account/dogs/new">add a dog</Link>), then come back here to confirm.
            </Alert>
          ) : null}
          <ul className={s.list}>
            {days.offers.map((o) => (
              <li key={o.id} className={s.listItem} style={{ display: 'block' }}>
                <p>
                  <strong>{o.dogName}</strong>: {plan(o.weekdays, o.session, o.taxi)}, from {formatUkDate(o.startsOn)}
                </p>
                {dogsFree.length ? (
                  <Stack>
                    <ActionForm action={confirmOfferAction}>
                      <input type="hidden" name="offerId" value={o.id} />
                      <SelectField
                        name="dogId"
                        label={`Which of your dogs is ${o.dogName}?`}
                        options={dogsFree.map((d) => ({ value: d.id, label: d.name }))}
                        defaultValue={dogsFree.find((d) => d.name.toLowerCase() === o.dogName.toLowerCase())?.id}
                      />
                      <div>
                        <SubmitButton>
                          Confirm these days <span className="visually-hidden">for {o.dogName}</span>
                        </SubmitButton>
                      </div>
                    </ActionForm>
                    <details>
                      <summary>Ask for different days for {o.dogName}</summary>
                      <ActionForm action={requestMembershipDaysAction}>
                        <input type="hidden" name="offerId" value={o.id} />
                        <SelectField
                          name="dogId"
                          label="Dog"
                          options={dogsFree.map((d) => ({ value: d.id, label: d.name }))}
                          defaultValue={dogsFree.find((d) => d.name.toLowerCase() === o.dogName.toLowerCase())?.id}
                        />
                        <DayPicker open={settings.openWeekdays} checked={o.weekdays} />
                        <input type="hidden" name="session" value="full" />
                        <Checkbox name="taxi" label="Use the dog taxi (included)" defaultChecked={o.taxi} />
                        <TextField
                          name="startsOn"
                          label="First day"
                          type="date"
                          required
                          defaultValue={o.startsOn > today ? o.startsOn : tomorrow}
                          min={tomorrow}
                        />
                        <div>
                          <SubmitButton variant="secondary">Send for approval</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  </Stack>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card aria-labelledby="yours">
        <h2 id="yours">Your dogs’ regular days</h2>
        {days.dogs.length === 0 ? (
          <Muted>
            No dogs yet. <Link href="/account/dogs/new">Add a dog</Link>.
          </Muted>
        ) : null}
        <ul className={s.list}>
          {days.dogs.map((d) => {
            const pending = pendingFor(d.id);
            const m = d.membership;
            return (
              <li key={d.id} className={s.listItem} style={{ display: 'block' }}>
                <div className={s.row}>
                  <div>
                    <strong>{d.name}</strong>
                    <div className={s.hint}>
                      {m
                        ? `${plan(m.weekdays, m.session, m.taxi)} · from ${formatUkDate(m.startsOn)}${m.endsOn ? ` to ${formatUkDate(m.endsOn)}` : ''}`
                        : 'No regular days yet'}
                    </div>
                  </div>
                  {pending ? <StatusBadge tone="info">Change waiting for approval</StatusBadge> : null}
                </div>
                {pending ? (
                  <Stack>
                    <p className={s.hint}>{pending.summary}</p>
                    <p>
                      <Link href={`/account/requests/${pending.id}/withdraw`}>
                        Withdraw request <span className="visually-hidden">for {d.name}</span>
                      </Link>{' '}
                      · <Link href="/account/requests">Your requests</Link>
                    </p>
                  </Stack>
                ) : (
                  <details>
                    <summary>{m ? `Change ${d.name}’s days for all future months` : `Choose ${d.name}’s days`}</summary>
                    <ActionForm action={requestMembershipDaysAction}>
                      <input type="hidden" name="dogId" value={d.id} />
                      {m ? (
                        <p>
                          New days start on {formatUkDate(days.changeFrom)} (the first month we haven’t invoiced yet).
                          To move one day only, use <Link href="/account/bookings">Your bookings</Link>.
                        </p>
                      ) : null}
                      <DayPicker open={settings.openWeekdays} checked={m?.weekdays ?? []} />
                      <input type="hidden" name="session" value="full" />
                      <Checkbox name="taxi" label="Use the dog taxi (included)" defaultChecked={m?.taxi ?? false} />
                      {m ? null : (
                        <TextField
                          name="startsOn"
                          label="First day"
                          type="date"
                          required
                          defaultValue={tomorrow}
                          min={tomorrow}
                        />
                      )}
                      <div>
                        <SubmitButton variant="secondary">Send for approval</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                )}
                {m && !m.endsOn ? (
                  <details>
                    <summary>End {d.name}’s membership</summary>
                    <ActionForm action={leaveMembershipAction}>
                      <p>
                        Leaving takes effect from {formatUkDate(leaveFrom)} (the 1st of next month if you tell us by the
                        20th).
                      </p>
                      <input type="hidden" name="id" value={m.id} />
                      <Checkbox
                        name="confirm"
                        label={`End ${d.name}’s membership (last day ${formatUkDate(addDays(leaveFrom, -1))})`}
                      />
                      <div>
                        <SubmitButton variant="danger">End membership</SubmitButton>
                      </div>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {memberRequests.some((r) => r.status !== 'pending') ? (
        <Card aria-labelledby="decisions">
          <h2 id="decisions">Your recent requests</h2>
          <ul className={s.list}>
            {memberRequests
              .filter((r) => r.status !== 'pending')
              .map((r) => (
                <li key={r.id} className={s.listItem}>
                  <div>
                    {r.summary}
                    {/* The Owner's note shows here only, never in emails. */}
                    {r.reason ? <div className={s.hint}>Note from Luna’s K9 Club: {r.reason}</div> : null}
                  </div>
                  <StatusBadge tone={OUTCOME[r.status]!.tone}>{OUTCOME[r.status]!.text}</StatusBadge>
                </li>
              ))}
          </ul>
        </Card>
      ) : null}

      {legacyRequests.length ? (
        <Card aria-labelledby="older">
          <h2 id="older">Earlier membership requests</h2>
          <ul className={s.list}>
            {legacyRequests.map((m) => (
              <li key={m.id} className={s.listItem}>
                <div>
                  <strong>{m.dogName}</strong> · {plan(m.weekdays, m.session, m.taxi)}
                  <div className={s.hint}>Waiting for Luna’s K9 Club</div>
                </div>
                <ActionForm action={withdrawMembershipAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <SubmitButton variant="secondary">
                    Withdraw request <span className="visually-hidden">for {m.dogName}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
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
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Ad hoc (no membership)</td>
                  <td>{formatPounds(book.adHocFullPence)}</td>
                </tr>
                <tr>
                  <td>1–{book.memberHighFromDays - 1} days a week</td>
                  <td>{formatPounds(book.memberLowFullPence)}</td>
                </tr>
                <tr>
                  <td>{book.memberHighFromDays}–5 days a week</td>
                  <td>{formatPounds(book.memberHighFullPence)}</td>
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
    </Stack>
  );
}
