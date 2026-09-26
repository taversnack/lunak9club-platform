import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Muted, Stack } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { listCustomers } from '@/server/services/owner-review';
import { getDb } from '@/infra/db/client';

export const metadata: Metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePermission('customers.read');
  const { q } = await searchParams;
  const rows = await listCustomers(getDb(), actor, q);
  return (
    <Stack>
      <h1>Customers</h1>
      <form role="search" className={s.row} style={{ justifyContent: 'flex-start' }}>
        <label htmlFor="q" className={s.label}>
          Search
        </label>
        <input id="q" name="q" className={s.input} defaultValue={q} placeholder="Name, email or postcode" />
        <button type="submit" className={`${s.button} ${s.secondary}`}>
          Search
        </button>
      </form>
      <Card>
        {rows.length === 0 ? (
          <Muted>{q ? 'No customers match that search.' : 'No customers yet.'}</Muted>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Customers" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Postcode</th>
                  <th scope="col">Dogs</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/customers/${c.id}`}>{c.name}</Link>
                    </td>
                    <td>{c.email}</td>
                    <td>{c.phone ?? '–'}</td>
                    <td>{c.postcode ?? '–'}</td>
                    <td>{c.dogCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Stack>
  );
}
