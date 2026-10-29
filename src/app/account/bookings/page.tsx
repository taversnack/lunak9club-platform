import type { Metadata } from 'next';
import type { Route } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, buttonClass, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myBookings } from '@/server/services/bookings';
import { myHoldsWithoutPayLink, myOpenCheckouts } from '@/server/services/payments';
import { pounds } from '@/domain/pricing/engine';
import { myInvoice } from '@/server/services/billing';
import { NotFoundError } from '@/server/errors';
import { formatPounds, SESSION_LABELS } from '@/domain/booking/rules';
import { formatUkDate } from '@/domain/time';
import { formatDateTimeLondon } from '@/ui/format';
import { withdrawRequestAction } from '../actions';
import { myApprovalRequests, myPendingApprovals } from '@/server/services/approvals';
import { REQUEST_NOT_SECURED } from '@/domain/booking/wording';

/** A receipt id from the query string; anything else gets no link. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = { title: 'Your bookings' };
export const dynamic = 'force-dynamic';

const STATUS: Record<string, { tone: 'info' | 'success' | 'warning' | 'danger'; text: string }> = {
  requested: { tone: 'warning', text: 'Requested – waiting for approval' },
  confirmed: { tone: 'success', text: 'Booked' },
  pending_payment: { tone: 'warning', text: 'Awaiting payment' },
  waitlisted: { tone: 'info', text: 'On the waitlist' },
  attended: { tone: 'success', text: 'Attended' },
  no_show: { tone: 'danger', text: 'No-show' },
  cancelled: { tone: 'info', text: 'Cancelled' },
  rejected: { tone: 'danger', text: 'Not approved' },
};

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requirePermission('account.access');
  const sp = await searchParams;
  const [{ upcoming, past }, checkouts, requests, decided, moves, unlinked] = await Promise.all([
    myBookings(getDb(), actor),
    myOpenCheckouts(getDb(), actor),
    myApprovalRequests(getDb(), actor, { type: 'booking.request', status: 'pending' }),
    myApprovalRequests(getDb(), actor, { type: 'booking.request', status: 'all' }),
    myPendingApprovals(getDb(), actor, { type: 'membership.move_once' }),
    myHoldsWithoutPayLink(getDb(), actor),
  ]);
  // A pay link for something already paid: show what was paid, when, and the receipt's reference.
  const receipt =
    sp.payment === 'already-paid' && sp.receipt && UUID.test(sp.receipt)
      ? await myInvoice(getDb(), actor, sp.receipt).catch((e: unknown) => {
          if (e instanceof NotFoundError) return null;
          throw e;
        })
      : null;
  const paidOn = receipt?.payments
    .map((x) => x.receivedOn)
    .sort()
    .at(-1);
  // The Owner's note on a decided request is shown here only – never emailed (D80).
  const notes = decided.filter((r) => r.status !== 'pending' && r.reason).slice(0, 5);
  const moving = new Set(moves.map((m) => m.subjectKey.replace(/^booking_dog:/, '')));
  return (
    <Stack>
      <div className={s.row}>
        <h1>Your bookings</h1>
        <Link href="/account/book" className={buttonClass('primary')}>
          Book day care
        </Link>
      </div>
      {sp.requested !== undefined ? (
        <Alert tone={Number(sp.requested) ? 'warning' : 'success'} title="Booking request sent">
          <p>
            {sp.requested} {Number(sp.requested) === 1 ? 'day' : 'days'} requested
            {Number(sp.waitlisted) ? `, ${sp.waitlisted} on the waitlist` : ''}
            {Number(sp.skipped) ? `, ${sp.skipped} not requested` : ''}. We’ve emailed you a summary.
          </p>
          {Number(sp.requested) ? <p data-testid="request-not-secured">{REQUEST_NOT_SECURED}</p> : null}
        </Alert>
      ) : null}
      {sp.withdrawn ? (
        <Alert tone="success" title="Request withdrawn">
          Nothing has been charged.
        </Alert>
      ) : null}
      {sp.left === 'waitlist' ? (
        <Alert tone="success" title="You’ve left the waitlist">
          There’s no charge.
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
      {sp.payment === 'already-paid' ? (
        <Alert tone="success" title="This booking is already paid">
          <p>There’s nothing more to pay – your places are booked. They’re listed below.</p>
          {receipt ? (
            <>
              <p data-testid="already-paid-summary">
                {pounds(receipt.bal.paidPence)} paid{paidOn ? ` on ${formatUkDate(paidOn)}` : ''}. Reference{' '}
                {receipt.inv.number}.
              </p>
              <p>
                <Link href={`/account/invoices/${receipt.inv.id}` as Route}>View the receipt</Link>
              </p>
            </>
          ) : null}
        </Alert>
      ) : null}
      {sp.payment === 'booking-cancelled' ? (
        <Alert tone="info" title="This booking was cancelled">
          There’s nothing to pay for it. You can book again whenever you like.
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
      {sp.payment === 'preparing' ? (
        <Alert tone="info" title="Your payment link is being prepared">
          That only takes a moment. Your places are still held – press “Pay now” again in a few seconds.
        </Alert>
      ) : null}
      {sp.payment === 'unavailable' ? (
        <Alert tone="warning" title="We couldn’t create your payment link">
          Sorry – we couldn’t create your payment link just now. Your places are still held. Please try again in a few
          minutes.
        </Alert>
      ) : null}
      {unlinked.map((u) => (
        <Alert key={u.bookingId} tone="warning" title={`Waiting for payment: ${pounds(u.amountPence)}`}>
          <p>
            Day care for {u.dogs} ({u.days} {u.days === 1 ? 'session' : 'sessions'}). You need to pay to secure this
            booking. Held until {formatDateTimeLondon(u.holdUntil)}, then released.
          </p>
          <p>
            <a className={buttonClass('primary')} href={`/api/payments/pay-booking/${u.bookingId}`}>
              Pay now {pounds(u.amountPence)} by card
            </a>
          </p>
        </Alert>
      ))}
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
      {requests.length ? (
        <Card aria-labelledby="requests">
          <h2 id="requests">Requests waiting for approval ({requests.length})</h2>
          <p>{REQUEST_NOT_SECURED}</p>
          <ul className={s.list}>
            {requests.map((r) => (
              <li key={r.id} className={s.listItem}>
                <span>
                  {r.summary} · sent {formatDateTimeLondon(r.createdAt)}
                </span>
                <ActionForm action={withdrawRequestAction}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <SubmitButton variant="secondary" pendingText="Withdrawing…">
                    Withdraw request <span className="visually-hidden">{r.summary}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {notes.map((r) => (
        <Alert
          key={r.id}
          tone="info"
          title={`Note from Luna’s K9 Club about your request (${r.status === 'approved' ? 'approved' : 'not approved'})`}
        >
          <p>{r.reason}</p>
        </Alert>
      ))}
      {sp.moveRequested ? (
        <Alert tone="success" title="Move requested">
          Thanks – we’ll check there’s space and confirm. Your day stays booked until then.
        </Alert>
      ) : null}
      {moves.map((m) => (
        <Alert key={m.id} tone="info" title="Move waiting for approval">
          <p>{m.summary}</p>
          <Link href={`/account/requests/${m.id}/withdraw`}>Withdraw move</Link> ·{' '}
          <Link href="/account/requests">Your requests</Link>
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
                      <StatusBadge tone={STATUS[b.status]!.tone}>{STATUS[b.status]!.text}</StatusBadge>
                    </td>
                    <td>
                      {b.kind === 'membership' && b.status === 'confirmed' && !b.late && !moving.has(b.id) ? (
                        <>
                          <Link
                            href={`/account/bookings/${b.id}/move`}
                            style={{ display: 'inline-block', minHeight: 24, minWidth: 24, marginInlineEnd: 12 }}
                          >
                            Move{' '}
                            <span className="visually-hidden">{`${b.dogName} on ${formatUkDate(b.serviceDate)}`}</span>
                          </Link>{' '}
                        </>
                      ) : null}
                      {b.cancellable ? (
                        <Link
                          href={`/account/bookings/${b.id}/cancel`}
                          style={{ display: 'inline-block', minHeight: 24, minWidth: 24 }}
                        >
                          Cancel{' '}
                          <span className="visually-hidden">{`${b.dogName} on ${formatUkDate(b.serviceDate)}`}</span>
                        </Link>
                      ) : b.withdrawable ? (
                        <Link href={`/account/bookings/${b.id}/cancel`}>
                          Withdraw day{' '}
                          <span className="visually-hidden">{`${b.dogName} on ${formatUkDate(b.serviceDate)}`}</span>
                        </Link>
                      ) : b.leavable ? (
                        <Link href={`/account/bookings/${b.id}/leave` as Route}>
                          Leave waitlist{' '}
                          <span className="visually-hidden">{`for ${b.dogName} on ${formatUkDate(b.serviceDate)}`}</span>
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
