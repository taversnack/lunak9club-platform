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
    </Stack>
  );
}
