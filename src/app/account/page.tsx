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
import { formatUkDate, londonDate } from '@/domain/time';
import { pounds } from '@/domain/pricing/engine';
import { formatDateTimeLondon } from '@/ui/format';
import { asUser } from '@/server/services/customers';
import { daysLabel, overviewTimeline } from '@/domain/booking/overview';

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
  const now = new Date();
  const canBook = dogs.some((d) => d.evaluation.canBook);
  // One rule for both lists: a hold whose pay-by time has passed is released (Needs you drops it too).
  const timeline = overviewTimeline([...bookings.upcoming, ...bookings.past], {
    now,
    today: londonDate(now),
    myUserId: asUser(actor).userId,
    freeCancelHours: bookings.freeCancellationHours,
    formatHold: formatDateTimeLondon,
  });
  // Name each pay link by its dog(s) and date(s), so several "Pay" links can be told apart (WCAG 2.4.4).
  const held = (bookingId: string) =>
    bookings.upcoming.filter((b) => b.bookingId === bookingId && b.status === 'pending_payment');
  const payItems = [
    ...checkouts.map((c) => ({
      key: c.id,
      amountPence: c.amountPence,
      by: c.expiresAt,
      href: `/api/payments/pay/${c.id}`,
      what: daysLabel(c.days.length ? c.days : held(c.bookingId!)),
    })),
    ...unlinked.map((u) => ({
      key: u.bookingId,
      amountPence: u.amountPence,
      by: u.holdUntil,
      href: `/api/payments/pay-booking/${u.bookingId}`,
      what: daysLabel(held(u.bookingId)),
    })),
  ];
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
        {canBook ? (
          <Link href="/account/book" className={buttonClass('primary')}>
            Request a day
          </Link>
        ) : (
          <Muted>Booking opens once your dog has been approved.</Muted>
        )}
      </Card>
      <Card aria-labelledby="needs-you">
        <h2 id="needs-you">Needs you</h2>
        {payItems.length + toConfirm.length + dogTodo.length === 0 ? (
          <p>
            <StatusBadge tone="success">All done</StatusBadge> Nothing needs you right now.
          </p>
        ) : (
          <ul className={s.list}>
            {payItems.map((p) => (
              <li key={p.key} className={s.listItem}>
                <span className={s.wrapText}>
                  <strong>{p.what}</strong>: approved, pay to secure your booking
                  <br />
                  <span className={s.hint}>Pay by {formatDateTimeLondon(p.by)}, or the places are released.</span>
                </span>
                <a className={`${buttonClass('primary')} ${s.wrapButton}`} href={p.href}>
                  Pay {pounds(p.amountPence)} for {p.what}
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
            {timeline.map((b) => (
              <li key={b.id} className={s.listItem} style={{ display: 'block' }}>
                <p className={s.wrapText}>
                  <strong>{formatUkDate(b.serviceDate)}</strong> · {b.dogName}{' '}
                  <StatusBadge tone={b.state.tone}>{b.state.text}</StatusBadge>
                  <br />
                  <span className={s.hint}>{b.state.next}</span>
                </p>
              </li>
            ))}
          </ol>
        )}
        <p>
          <Link href="/account/bookings" className={s.tapLink}>
            All bookings
          </Link>{' '}
          ·{' '}
          <Link href="/account/requests" className={s.tapLink}>
            Your requests
          </Link>
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
          {payItems.length ? (
            <Muted>No invoices to pay. Pay for your approved days under Needs you.</Muted>
          ) : (
            <Muted>Nothing to pay.</Muted>
          )}
        </Card>
      </Grid>
    </Stack>
  );
}
