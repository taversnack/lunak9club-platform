import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Muted, Stack } from '@/ui/components';
import { InvoiceState } from '@/ui/invoice-state';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myInvoices } from '@/server/services/billing';
import { formatMonth } from '@/domain/billing/rules';
import { pounds } from '@/domain/pricing/engine';
import { formatUkDate } from '@/domain/time';

export const metadata: Metadata = { title: 'Your invoices' };
export const dynamic = 'force-dynamic';

export default async function MyInvoicesPage() {
  const actor = await requirePermission('account.access');
  const rows = await myInvoices(getDb(), actor);
  return (
    <Stack>
      <h1>Your invoices</h1>
      <p>
        Membership days are invoiced monthly in advance, and you’ll get an email when each invoice is ready. Other
        bookings are paid by card when you book; their receipts are here too.
      </p>
      <Card aria-labelledby="list">
        <h2 id="list">Invoices</h2>
        {rows.length === 0 ? (
          <Muted>You don’t have any invoices yet.</Muted>
        ) : (
          <div className={s.tableWrap} role="region" aria-label="Your invoices" tabIndex={0}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col">Month</th>
                  <th scope="col">Total</th>
                  <th scope="col">To pay</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ inv, bal, state }) => (
                  <tr key={inv.id}>
                    <td>
                      <Link href={`/account/invoices/${inv.id}`}>{inv.number}</Link>
                    </td>
                    <td>{formatMonth(inv.periodMonth)}</td>
                    <td>{pounds(bal.totalPence)}</td>
                    <td>{pounds(bal.duePence)}</td>
                    <td>{inv.dueDate ? formatUkDate(inv.dueDate) : '–'}</td>
                    <td>
                      <InvoiceState state={state} />
                    </td>
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
