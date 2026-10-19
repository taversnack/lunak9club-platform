import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, buttonClass, Card, DateCard, Grid, Muted, Stack, StatusBadge } from '@/ui/components';
import { myBookings } from '@/server/services/bookings';
import { SESSION_LABELS } from '@/domain/booking/rules';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { getMyCustomer, isProfileComplete, listMyContacts } from '@/server/services/customers';
import { listMyDogs } from '@/server/services/dogs';
import { myTermsStatus } from '@/server/services/policies';
import { OVERALL_LABELS } from '@/domain/compliance/evaluate';

export const metadata: Metadata = { title: 'My account' };
export const dynamic = 'force-dynamic';

const UPCOMING_STATUS: Record<string, { tone: 'info' | 'success' | 'warning' | 'danger'; text: string }> = {
  confirmed: { tone: 'success', text: 'Booked' },
  pending_payment: { tone: 'warning', text: 'Pay now' },
  waitlisted: { tone: 'info', text: 'Waitlist' },
  offered: { tone: 'warning', text: 'Place offered' },
  attended: { tone: 'success', text: 'Attended' },
};

export default async function AccountPage() {
  const actor = await requirePermission('account.access');
  const db = getDb();
  const [customer, dogs, contacts, terms, bookings] = await Promise.all([
    getMyCustomer(db, actor),
    listMyDogs(db, actor),
    listMyContacts(db, actor),
    myTermsStatus(db, actor),
    myBookings(db, actor),
  ]);
  const next = bookings.upcoming.slice(0, 3);
  const canBook = dogs.some((d) => d.evaluation.canBook);
  const first = actor.name.split(' ')[0];
  const todo: { href: '/account/profile' | '/account/contacts' | '/account/terms'; text: string }[] = [];
  if (!isProfileComplete(customer)) todo.push({ href: '/account/profile', text: 'Add your phone number and address' });
  if (!contacts.some((c) => c.isEmergencyContact))
    todo.push({ href: '/account/contacts', text: 'Add an emergency contact' });
  if (terms.terms && !terms.acceptedAt) todo.push({ href: '/account/terms', text: 'Read and accept our terms' });

  return (
    <Stack>
      {/* "Book a day" lives in the header (always visible), so no second button here. */}
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
        <Card aria-labelledby="next-booking">
          <div className={s.cardHead}>
            <h2 id="next-booking">Upcoming days</h2>
            <Link href="/account/bookings">All bookings</Link>
          </div>
          {next.length ? (
            <ul className={s.cardList}>
              {next.map((b) => {
                const st = UPCOMING_STATUS[b.status] ?? { tone: 'info' as const, text: b.status };
                return (
                  <li key={b.id}>
                    <DateCard
                      date={b.serviceDate}
                      title={`${b.dogName} · ${SESSION_LABELS[b.session]}`}
                      detail={b.taxi ? 'With taxi' : undefined}
                      status={<StatusBadge tone={st.tone}>{st.text}</StatusBadge>}
                    />
                  </li>
                );
              })}
            </ul>
          ) : canBook ? (
            <Stack>
              <Muted>No days booked yet.</Muted>
              <p>
                <Link href="/account/book" className={buttonClass('primary')}>
                  Book day care
                </Link>
              </p>
            </Stack>
          ) : (
            <Muted>Booking opens once your dog has been approved.</Muted>
          )}
        </Card>
        <Card aria-labelledby="invoices">
          <h2 id="invoices">Invoices</h2>
          <Muted>Nothing to pay.</Muted>
        </Card>
      </Grid>
    </Stack>
  );
}
