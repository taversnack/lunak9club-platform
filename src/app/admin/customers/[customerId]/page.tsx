import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import s from '@/ui/ui.module.css';
import { Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getCustomerForOwner } from '@/server/services/owner-review';
import { NotFoundError } from '@/server/errors';
import { getDb } from '@/infra/db/client';
import { OVERALL_LABELS } from '@/domain/compliance/evaluate';
import { ActionForm, SelectField, SubmitButton, TextField } from '@/ui/form';
import { listCustomerRates } from '@/server/services/pricing';
import { formatPounds } from '@/domain/booking/rules';
import { formatUkDate, londonDate } from '@/domain/time';
import { addCustomerRateAction, endCustomerRateAction } from '../../actions';
import { Alert } from '@/ui/components';
import { Checkbox } from '@/ui/form';
import { DayPicker } from '@/ui/day-picker';
import { loadSettings } from '@/server/services/booking-shared';
import { describeWeekdays } from '@/server/services/memberships';
import { inviteStatus, ownerMembershipOverview } from '@/server/services/membership-workflow';
import { SESSION_LABELS, type Session } from '@/domain/booking/rules';
import { addDays } from '@/domain/time';
import { formatDateTimeLondon } from '@/ui/format';
import { ownerConfirmMonthAction, ownerSetDaysAction, resendInviteAction } from '../actions';

export const metadata: Metadata = { title: 'Customer' };
export const dynamic = 'force-dynamic';

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('customers.read');
  const { customerId } = await params;
  let c;
  try {
    c = await getCustomerForOwner(getDb(), actor, customerId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const [rates, invite, membership, settings] = await Promise.all([
    listCustomerRates(getDb(), actor, customerId),
    inviteStatus(getDb(), actor, customerId),
    ownerMembershipOverview(getDb(), actor, customerId),
    loadSettings(getDb()),
  ]);
  const today = londonDate(new Date());
  const addr = [c.customer.addressLine1, c.customer.addressLine2, c.customer.town, c.customer.postcode]
    .filter(Boolean)
    .join(', ');
  return (
    <Stack>
      <p className={s.breadcrumb}>
        <Link href="/admin/customers">Customers</Link> › {c.name}
      </p>
      <h1>{c.name}</h1>
      {sp.created ? (
        <Alert tone="success" title="Account created">
          We’ve emailed {c.name} a link to finish signing up.
        </Alert>
      ) : null}
      {invite.state !== 'signed_up' ? (
        <Card aria-labelledby="invite">
          <h2 id="invite">Finish-signing-up link</h2>
          <p>
            {invite.state === 'sent'
              ? `Sent – the link works until ${formatDateTimeLondon(invite.expiresAt)}.`
              : invite.state === 'expired'
                ? 'The link has expired or been replaced.'
                : 'No link sent yet.'}
          </p>
          <ActionForm action={resendInviteAction}>
            <input type="hidden" name="customerId" value={customerId} />
            <SubmitButton variant="secondary">Send a new link</SubmitButton>
          </ActionForm>
        </Card>
      ) : null}
      <div className={s.two}>
        <Card aria-labelledby="contact">
          <h2 id="contact">Contact details</h2>
          <dl className={s.dl}>
            <dt>Email</dt>
            <dd>{c.email}</dd>
            <dt>Phone</dt>
            <dd>{c.customer.phone ?? '–'}</dd>
            <dt>Address</dt>
            <dd>{addr || '–'}</dd>
          </dl>
        </Card>
        <Card aria-labelledby="contacts">
          <h2 id="contacts">Emergency contacts and collectors</h2>
          {c.contacts.length === 0 ? (
            <Muted>None added.</Muted>
          ) : (
            <ul className={s.list}>
              {c.contacts.map((x) => (
                <li key={x.id}>
                  <strong>{x.name}</strong> {x.relationship ? `(${x.relationship})` : ''} – {x.phone}
                  <div>
                    {x.isEmergencyContact ? <StatusBadge tone="info">Emergency</StatusBadge> : null}{' '}
                    {x.isAuthorisedCollector ? <StatusBadge tone="info">Can collect</StatusBadge> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card aria-labelledby="dogs">
        <h2 id="dogs">Dogs</h2>
        {c.dogs.length === 0 ? (
          <Muted>No dogs added yet.</Muted>
        ) : (
          <ul className={s.list}>
            {c.dogs.map((d) => {
              const l = OVERALL_LABELS[d.evaluation.overall];
              return (
                <li key={d.id} className={s.listItem}>
                  <Link href={`/admin/dogs/${d.id}`}>{d.name}</Link>
                  <StatusBadge tone={l.tone}>{l.text}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card aria-labelledby="membership">
        <h2 id="membership">Membership days</h2>
        {membership.offers.length ? (
          <>
            <h3>Waiting for the customer to confirm</h3>
            <ul className={s.list}>
              {membership.offers.map((o) => (
                <li key={o.id} className={s.listItem}>
                  <span>
                    <strong>{o.dogName}</strong>: {describeWeekdays(o.weekdays)} ·{' '}
                    {SESSION_LABELS[o.session as Session]}
                    {o.taxi ? ' · taxi' : ''} · from {formatUkDate(o.startsOn)}
                  </span>
                  <StatusBadge tone="info">Not confirmed yet</StatusBadge>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {membership.dogs.length === 0 ? <Muted>The customer hasn’t added a dog yet.</Muted> : null}
        <ul className={s.list}>
          {membership.dogs.map((d) => (
            <li key={d.id} className={s.listItem} style={{ display: 'block' }}>
              <p>
                <strong>{d.name}</strong>:{' '}
                {d.membership
                  ? `${describeWeekdays(d.membership.weekdays)} · ${SESSION_LABELS[d.membership.session as Session]}${d.membership.taxi ? ' · taxi' : ''} · from ${formatUkDate(d.membership.startsOn)}${d.membership.endsOn ? ` to ${formatUkDate(d.membership.endsOn)}` : ''}`
                  : 'no regular days'}
              </p>
              <details>
                <summary>{d.membership ? `Change ${d.name}’s days` : `Set ${d.name}’s days`}</summary>
                <ActionForm action={ownerSetDaysAction}>
                  <input type="hidden" name="dogId" value={d.id} />
                  <input type="hidden" name="customerId" value={customerId} />
                  {d.membership ? (
                    <p className={s.hint}>
                      Starts {formatUkDate(membership.changeFrom)} (the first month not yet invoiced). No approval
                      needed; the customer is emailed.
                    </p>
                  ) : null}
                  <DayPicker open={settings.openWeekdays} checked={d.membership?.weekdays ?? []} />
                  <input type="hidden" name="session" value="full" />
                  <Checkbox name="taxi" label="Uses the dog taxi" defaultChecked={d.membership?.taxi ?? false} />
                  {d.membership ? null : (
                    <TextField
                      name="startsOn"
                      label="First day"
                      type="date"
                      required
                      min={addDays(today, 1)}
                      defaultValue={addDays(today, 1)}
                    />
                  )}
                  <div>
                    <SubmitButton variant="secondary">Save days</SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
        <h3>Monthly confirmation</h3>
        <ul className={s.list}>
          {membership.months
            .filter((m) => m.hasDays)
            .map((m) => (
              <li key={m.month} className={s.listItem}>
                <span>
                  {m.monthText}:{' '}
                  {m.confirmedAt
                    ? `confirmed${m.byOwner ? ' by you' : ' by the customer'}${m.late ? ' after the confirm-by date' : ''}`
                    : 'not confirmed yet'}
                </span>
                {m.confirmedAt ? (
                  <StatusBadge tone={m.late ? 'warning' : 'success'}>
                    {m.late ? 'Confirmed late' : 'Confirmed'}
                  </StatusBadge>
                ) : (
                  <ActionForm action={ownerConfirmMonthAction}>
                    <input type="hidden" name="customerId" value={customerId} />
                    <input type="hidden" name="month" value={m.month} />
                    <SubmitButton variant="secondary">
                      Confirm for them <span className="visually-hidden">({m.monthText})</span>
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
        </ul>
        {membership.months.every((m) => !m.hasDays) ? (
          <Muted>No membership days booked this month or next.</Muted>
        ) : null}
      </Card>
      <Card aria-labelledby="rates">
        <h2 id="rates">Agreed prices</h2>
        <p className={s.hint}>
          Special prices for this customer take priority over membership and ad hoc prices for bookings made while they
          apply.
        </p>
        {rates.length === 0 ? (
          <Muted>None – standard prices apply.</Muted>
        ) : (
          <ul className={s.list}>
            {rates.map(({ rate, dogName }) => (
              <li key={rate.id} className={s.listItem}>
                <span>
                  {formatPounds(rate.fullDayPence)} full day
                  {rate.halfDayPence != null ? `, ${formatPounds(rate.halfDayPence)} half day` : ''} ·{' '}
                  {dogName ?? 'all dogs'} · {formatUkDate(rate.startsOn)}
                  {rate.endsOn ? ` to ${formatUkDate(rate.endsOn)}` : ' onwards'} · {rate.reason}
                </span>
                {rate.endsOn === null || rate.endsOn > today ? (
                  <ActionForm action={endCustomerRateAction}>
                    <input type="hidden" name="id" value={rate.id} />
                    <input type="hidden" name="customerId" value={c.customer.id} />
                    <SubmitButton variant="secondary">
                      End <span className="visually-hidden">rate {rate.reason}</span>
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <h3>Add an agreed price</h3>
        <ActionForm action={addCustomerRateAction}>
          <input type="hidden" name="customerId" value={c.customer.id} />
          <SelectField
            name="dogId"
            label="Dog"
            required={false}
            options={[
              { value: 'all', label: 'All their dogs' },
              ...c.dogs.map((d) => ({ value: d.id, label: d.name })),
            ]}
            defaultValue="all"
          />
          <TextField name="fullDay" label="Full day (£)" inputMode="decimal" required />
          <TextField name="startsOn" label="From" type="date" required defaultValue={today} />
          <TextField name="endsOn" label="Until" type="date" hint="Leave blank for no end date" />
          <TextField name="reason" label="Reason (the customer sees this on their booking)" required />
          <div>
            <SubmitButton variant="secondary">Add price</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </Stack>
  );
}
