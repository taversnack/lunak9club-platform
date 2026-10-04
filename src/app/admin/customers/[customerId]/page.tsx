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

export const metadata: Metadata = { title: 'Customer' };
export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const actor = await requirePermission('customers.read');
  const { customerId } = await params;
  let c;
  try {
    c = await getCustomerForOwner(getDb(), actor, customerId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const rates = await listCustomerRates(getDb(), actor, customerId);
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
          <TextField
            name="halfDay"
            label="Half day (£)"
            inputMode="decimal"
            hint="Leave blank to use the usual half-day percentage"
          />
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
