import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, buttonClass, Card, Grid, Muted, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { getMyCustomer, isProfileComplete, listMyContacts } from '@/server/services/customers';
import { listMyDogs } from '@/server/services/dogs';
import { myTermsStatus } from '@/server/services/policies';
import { OVERALL_LABELS } from '@/domain/compliance/evaluate';
import { myBookings } from '@/server/services/bookings';
import { myHoldsWithoutPayLink, myOpenCheckouts } from '@/server/services/payments';
import { myMonthConfirmations } from '@/server/services/membership-workflow';
import { formatUkDate } from '@/domain/time';
import { pounds } from '@/domain/pricing/engine';
import { formatDateTimeLondon } from '@/ui/format';

/** One line per request status: what it means and what happens next (D76, D80). */
const TIMELINE: Record<
  string,
  {
    tone: 'info' | 'success' | 'warning' | 'danger';
    text: string;
    next: (hold: Date | null, freeCancelHours: number) => string;
  }
> = {
  requested: {
    tone: 'warning',
    text: 'Requested',
    next: () =>
      'Luna’s K9 Club will reply soon. Nothing to pay yet, and the day isn’t secured until it’s approved and paid for.',
  },
  pending_payment: {
    tone: 'warning',
    text: 'Approved – pay to secure',
    next: (hold) =>
      hold ? `Pay by ${formatDateTimeLondon(hold)} to secure the day, or it’s released.` : 'Pay to secure the day.',
  },
  confirmed: {
    tone: 'success',
    text: 'Confirmed',
    next: (_hold, hours) => `You’re booked. Cancel at least ${hours} hours ahead for a full refund.`,
  },
  waitlisted: { tone: 'info', text: 'On the waitlist', next: () => 'We’ll email you if a place opens up.' },
  rejected: { tone: 'danger', text: 'Declined', next: () => 'Nothing to pay. You’re welcome to request another day.' },
};

export const metadata: Metadata = { title: 'My account' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const actor = await requirePermission('account.access');
  const db = getDb();
  const [customer, dogs, contacts, terms, bookings, checkouts, unlinked, confirmations] = await Promise.all([
    getMyCustomer(db, actor),
    listMyDogs(db, actor),
    listMyContacts(db, actor),
    myTermsStatus(db, actor),
    myBookings(db, actor),
    myOpenCheckouts(db, actor),
    myHoldsWithoutPayLink(db, actor),
    myMonthConfirmations(db, actor),
  ]);
  const nextUp = bookings.upcoming.find((b) => b.status === 'confirmed') ?? null;
  const toConfirm = confirmations.filter((c) => !c.confirmedAt);
  const dogTodo = dogs
    .map((d) => ({ d, left: d.evaluation.items.filter((i) => i.mandatory && i.action).length }))
    .filter((x) => x.left > 0);
  const timeline = [...bookings.upcoming, ...bookings.past.filter((b) => b.status === 'rejected')]
    .filter((b) => b.status in TIMELINE)
    .slice(0, 6);
  const first = actor.name.split(' ')[0];
  const todo: { href: '/account/profile' | '/account/contacts' | '/account/terms'; text: string }[] = [];
  if (!isProfileComplete(customer)) todo.push({ href: '/account/profile', text: 'Add your phone number and address' });
  if (!contacts.some((c) => c.isEmergencyContact))
    todo.push({ href: '/account/contacts', text: 'Add an emergency contact' });
  if (terms.terms && !terms.acceptedAt) todo.push({ href: '/account/terms', text: 'Read and accept our terms' });

  return (
    <Stack>
      <h1>Hello, {first}</h1>
      {todo.length ? (
        <Alert tone="info" title="To finish setting up your account">
          <ul>
            {todo.map((t) => (
              <li key={t.href}>
                <Link href={t.href}>{t.text}</Link>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <Card aria-labelledby="next-up">
        <h2 id="next-up">Next up</h2>
        {nextUp ? (
          <p>
            <strong>{formatUkDate(nextUp.serviceDate)}</strong> · {nextUp.dogName}
            {nextUp.taxi ? ' · dog taxi' : ''}
          </p>
        ) : (
          <Muted>No days booked yet.</Muted>
        )}
        {dogs.some((d) => d.evaluation.canBook) ? (
          <Link href="/account/book" className={buttonClass('primary')}>
            Request a day
          </Link>
        ) : null}
      </Card>
      <Card aria-labelledby="needs-you">
        <h2 id="needs-you">Needs you</h2>
        {checkouts.length + unlinked.length + toConfirm.length + dogTodo.length === 0 ? (
          <p>
            <StatusBadge tone="success">All done</StatusBadge> Nothing needs you right now.
          </p>
        ) : (
          <ul className={s.list}>
            {checkouts.map((c) => (
              <li key={c.id} className={s.listItem}>
                <span>
                  <strong>Pay {pounds(c.amountPence)}</strong> to secure your booking
                  <br />
                  <span className={s.hint}>
                    Pay by {formatDateTimeLondon(c.expiresAt)}, or the places are released.
                  </span>
                </span>
                <a className={buttonClass('primary')} href={`/api/payments/pay/${c.id}`}>
                  Pay now
                </a>
              </li>
            ))}
            {unlinked.map((u) => (
              <li key={u.bookingId} className={s.listItem}>
                <span>
                  <strong>Pay {pounds(u.amountPence)}</strong> to secure your booking
                  <br />
                  <span className={s.hint}>
                    Pay by {formatDateTimeLondon(u.holdUntil)}, or the places are released.
                  </span>
                </span>
                <a className={buttonClass('primary')} href={`/api/payments/pay-booking/${u.bookingId}`}>
                  Pay now
                </a>
              </li>
            ))}
            {toConfirm.map((c) => (
              <li key={c.month} className={s.listItem}>
                <span>
                  <strong>Confirm your {c.monthText} membership days</strong>
                  <br />
                  <span className={s.hint}>Please confirm by {formatUkDate(c.by)}.</span>
                </span>
                <Link href="/account/membership">Confirm</Link>
              </li>
            ))}
            {dogTodo.map(({ d, left }) => (
              <li key={d.id} className={s.listItem}>
                <span>
                  <strong>
                    {d.name}: {left} thing{left === 1 ? '' : 's'} to do
                  </strong>
                  <br />
                  <span className={s.hint}>Vaccination records and other documents.</span>
                </span>
                <Link href={`/account/dogs/${d.id}`}>
                  Open <span className="visually-hidden">{d.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card aria-labelledby="timeline">
        <h2 id="timeline">Your requests and bookings</h2>
        {timeline.length === 0 ? (
          <Muted>Nothing yet. When you request a day, you’ll see it here.</Muted>
        ) : (
          <ol className={s.list}>
            {timeline.map((b) => {
              const t = TIMELINE[b.status]!;
              return (
                <li key={b.id} className={s.listItem} style={{ display: 'block' }}>
                  <p>
                    <strong>{formatUkDate(b.serviceDate)}</strong> · {b.dogName}{' '}
                    <StatusBadge tone={t.tone}>{t.text}</StatusBadge>
                    <br />
                    <span className={s.hint}>{t.next(b.offerExpiresAt, bookings.freeCancellationHours)}</span>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
        <p>
          <Link href="/account/bookings">All bookings</Link> · <Link href="/account/requests">Your requests</Link>
        </p>
      </Card>
      <Card aria-labelledby="dogs">
        <div className={s.row}>
          <h2 id="dogs">Your dogs</h2>
          <Link href="/account/dogs/new" className={buttonClass('secondary')}>
            Add a dog
          </Link>
        </div>
        {dogs.length === 0 ? (
          <Muted>Add your dog to start their onboarding. You’ll need their vaccination record and vet’s details.</Muted>
        ) : (
          <ul className={s.list}>
            {dogs.map((d) => {
              const label = OVERALL_LABELS[d.evaluation.overall];
              const left = d.evaluation.items.filter((i) => i.mandatory && i.action).length;
              return (
                <li key={d.id} className={s.listItem}>
                  <div>
                    <Link href={`/account/dogs/${d.id}`}>
                      <strong>{d.name}</strong>
                    </Link>
                    <div className={s.muted}>{d.breed}</div>
                  </div>
                  <div>
                    <StatusBadge tone={label.tone}>{label.text}</StatusBadge>
                    {left ? (
                      <div className={s.hint}>
                        {left} thing{left === 1 ? '' : 's'} to do
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Grid>
        <Card aria-labelledby="invoices">
          <h2 id="invoices">Invoices</h2>
          <Muted>Nothing to pay.</Muted>
        </Card>
      </Grid>
    </Stack>
  );
}
