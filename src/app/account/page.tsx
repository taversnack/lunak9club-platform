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

export const metadata: Metadata = { title: 'My account' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const actor = await requirePermission('account.access');
  const db = getDb();
  const [customer, dogs, contacts, terms] = await Promise.all([
    getMyCustomer(db, actor),
    listMyDogs(db, actor),
    listMyContacts(db, actor),
    myTermsStatus(db, actor),
  ]);
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
          <h2 id="next-booking">Bookings</h2>
          {dogs.some((d) => d.evaluation.canBook) ? (
            <p>
              <Link href="/account/book" className={buttonClass('primary')}>
                Book day care
              </Link>{' '}
              <Link href="/account/bookings">See your bookings</Link>
            </p>
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
