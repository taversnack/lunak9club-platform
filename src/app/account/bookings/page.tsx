import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, buttonClass, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myBookings } from '@/server/services/bookings';
import { myOpenCheckouts } from '@/server/services/payments';
import { pounds } from '@/domain/pricing/engine';
import { formatPounds, SESSION_LABELS } from '@/domain/booking/rules';
import { formatUkDate } from '@/domain/time';
import { formatDateTimeLondon } from '@/ui/format';
import { acceptOfferAction } from '../actions';

export const metadata: Metadata = { title: 'Your bookings' };
export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'info' | 'success' | 'warning' | 'danger'; text: string }> = {
  confirmed: { tone: 'success', text: 'Booked' },
  pending_payment: { tone: 'warning', text: 'Awaiting payment' },
  waitlisted: { tone: 'info', text: 'On the waitlist' },
  offered: { tone: 'warning', text: 'Place offered' },
  attended: { tone: 'success', text: 'Attended' },
  no_show: { tone: 'danger', text: 'No-show' },
  cancelled: { tone: 'info', text: 'Cancelled' },
  rejected: { tone: 'danger', text: 'Not accepted' },
};

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requirePermission('account.access');
  const sp = await searchParams;
  const [{ upcoming, past }, checkouts] = await Promise.all([
    myBookings(getDb(), actor),
    myOpenCheckouts(getDb(), actor),
  ]);
  const offers = upcoming.filter((b) => b.offerLive);
  return (
    <Stack>
      <div className={s.row}>
        <h1>Your bookings</h1>
        <Link href="/account/book" className={buttonClass('primary')}>
          Book day care
        </Link>
      </div>
      {sp.booked !== undefined ? (
        <Alert tone="success" title="Booking confirmed">
          {sp.booked} booked{Number(sp.waitlisted) ? `, ${sp.waitlisted} on the waitlist` : ''}
          {Number(sp.skipped) ? `, ${sp.skipped} not booked` : ''}. We’ve emailed you a summary.
        </Alert>
      ) : null}
      {sp.cancelled ? (
        <Alert tone={sp.cancelled === 'late' ? 'warning' : 'success'} title="Booking cancelled">
          {sp.cancelled === 'late'
            ? 'This was less than 48 hours before, so the day is still charged.'
            : sp.cancelled === 'refunded'
              ? 'We’ve refunded this day to your card. It usually appears within 5–10 working days.'
              : 'No charge for this cancellation.'}
        </Alert>
      ) : null}
      {sp.payment === 'paid' ? (
        <Alert tone="success" title="Payment received – you’re booked">
          Thank you. We’ve emailed your receipt; you can also find it under Invoices.
        </Alert>
      ) : null}
      {sp.payment === 'processing' ? (
        <Alert tone="info" title="Checking your payment">
          We haven’t had confirmation from the card company yet. This page will show your booking as soon as it arrives
          – please don’t pay twice.
        </Alert>
      ) : null}
      {sp.payment === 'cancelled' ? (
        <Alert tone="warning" title="Payment not finished">
          Your places are still held for a short while. Pay below to keep them, or cancel them.
        </Alert>
      ) : null}
      {sp.payment === 'expired' ? (
        <Alert tone="info" title="That payment link has ended">
          The time to pay ran out, so the places were released. You can book again.
        </Alert>
      ) : null}
      {checkouts.map((c) => (
        <Alert key={c.id} tone="warning" title={`Waiting for payment: ${pounds(c.amountPence)}`}>
          <p>
            {c.description.replace(/^Luna’s K9 Club – /, '')}. Held until {formatDateTimeLondon(c.expiresAt)}, then
            released.
          </p>
          <p>
            <a className={buttonClass('primary')} href={`/api/payments/pay/${c.id}`}>
              Pay {pounds(c.amountPence)} by card
            </a>
          </p>
        </Alert>
      ))}
      {offers.map((o) => (
        <Alert key={o.id} tone="warning" title={`A place is available for ${o.dogName}`}>
          <p>
            {formatUkDate(o.serviceDate)}, {SESSION_LABELS[o.session]}. We’ll hold it until{' '}
            {o.offerExpiresAt ? formatDateTimeLondon(o.offerExpiresAt) : ''}.
          </p>
          <ActionForm action={acceptOfferAction}>
            <input type="hidden" name="bookingId" value={o.id} />
            <SubmitButton>Accept this place</SubmitButton>
          </ActionForm>
        </Alert>
      ))}
      <Card aria-labelledby="upcoming">
        <h2 id="upcoming">Coming up</h2>
        {upcoming.length === 0 ? (
          <Muted>No bookings yet.</Muted>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Upcoming bookings" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Dog</th>
                  <th scope="col">Session</th>
                  <th scope="col">Price</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((b) => (
                  <tr key={b.id}>
                    <td>{formatUkDate(b.serviceDate)}</td>
                    <td>{b.dogName}</td>
                    <td>
                      {SESSION_LABELS[b.session]}
                      {b.taxi ? ' + taxi' : ''}
                      {b.kind === 'membership' ? <div className={s.hint}>Membership day</div> : null}
                    </td>
                    <td>{b.pricePence != null ? formatPounds(b.pricePence) : '–'}</td>
                    <td>
                      <StatusBadge tone={STATUS[b.status]!.tone}>
                        {b.status === 'offered' && !b.offerLive ? 'Offer lapsed' : STATUS[b.status]!.text}
                      </StatusBadge>
                    </td>
                    <td>
                      {b.cancellable ? (
                        <Link href={`/account/bookings/${b.id}/cancel`}>
                          Cancel{' '}
                          <span className="visually-hidden">{`${b.dogName} on ${formatUkDate(b.serviceDate)}`}</span>
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card aria-labelledby="past">
        <h2 id="past">Past and cancelled</h2>
        {past.length === 0 ? (
          <Muted>Nothing yet.</Muted>
        ) : (
          <ul className={s.list}>
            {past.map((b) => (
              <li key={b.id} className={s.listItem}>
                <span>
                  {formatUkDate(b.serviceDate)} · {b.dogName} · {SESSION_LABELS[b.session]}
                </span>
                <StatusBadge tone={STATUS[b.status]!.tone}>
                  {STATUS[b.status]!.text}
                  {b.status === 'cancelled' && b.lateCancellation ? ' (late – charged)' : ''}
                </StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Stack>
  );
}
