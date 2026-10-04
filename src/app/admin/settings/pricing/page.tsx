import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, SubmitButton, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { listPriceBooks } from '@/server/services/pricing';
import { formatPounds } from '@/domain/booking/rules';
import { addDays, formatUkDate, londonDate } from '@/domain/time';
import { removePricesAction, schedulePricesAction } from '../../actions';

export const metadata: Metadata = { title: 'Prices' };
export const dynamic = 'force-dynamic';

const p2 = (pence: number) => (pence / 100).toFixed(2);

export default async function PricingPage() {
  const actor = await requirePermission('pricing.manage');
  const books = await listPriceBooks(getDb(), actor);
  const today = londonDate(new Date());
  const current = books.find((b) => b.effectiveFrom <= today && (b.effectiveTo === null || b.effectiveTo >= today));
  return (
    <Stack>
      <h1>Prices</h1>
      <Alert tone="info">
        Prices are fixed on each booking when it’s made. Changing prices only affects bookings made for dates on or
        after the new start date.
      </Alert>
      <Card aria-labelledby="books">
        <h2 id="books">Price lists</h2>
        <div className={s.tableWrap} role="region" aria-label="Price lists" tabIndex={0}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Dates</th>
                <th scope="col">Ad hoc</th>
                <th scope="col">1–3 days</th>
                <th scope="col">4–5 days</th>
                <th scope="col">Half day</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>
                    {formatUkDate(b.effectiveFrom)} – {b.effectiveTo ? formatUkDate(b.effectiveTo) : 'onwards'}
                  </td>
                  <td>{formatPounds(b.adHocFullPence)}</td>
                  <td>{formatPounds(b.memberLowFullPence)}</td>
                  <td>{formatPounds(b.memberHighFullPence)}</td>
                  <td>{b.halfDayPercent}%</td>
                  <td>
                    {b.id === current?.id ? (
                      <StatusBadge tone="success">In use</StatusBadge>
                    ) : b.effectiveFrom > today ? (
                      <StatusBadge tone="info">Scheduled</StatusBadge>
                    ) : (
                      <StatusBadge tone="info">Past</StatusBadge>
                    )}
                  </td>
                  <td>
                    {b.effectiveFrom > today && b.effectiveTo === null ? (
                      <ActionForm action={removePricesAction}>
                        <input type="hidden" name="id" value={b.id} />
                        <SubmitButton variant="secondary">
                          Remove <span className="visually-hidden">{b.name}</span>
                        </SubmitButton>
                      </ActionForm>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card aria-labelledby="new">
        <h2 id="new">Schedule new prices</h2>
        <ActionForm action={schedulePricesAction}>
          <TextField
            name="name"
            label="Name"
            required
            defaultValue={`Prices from ${formatUkDate(addDays(today, 30))}`}
          />
          <TextField
            name="effectiveFrom"
            label="Start date"
            type="date"
            required
            defaultValue={addDays(today, 30)}
            min={addDays(today, 1)}
          />
          <div className={s.two}>
            <TextField
              name="adHocFull"
              label="Ad hoc full day (£)"
              inputMode="decimal"
              required
              defaultValue={current ? p2(current.adHocFullPence) : ''}
            />
            <TextField
              name="memberLowFull"
              label="1–3 days a week, full day (£)"
              inputMode="decimal"
              required
              defaultValue={current ? p2(current.memberLowFullPence) : ''}
            />
            <TextField
              name="memberHighFull"
              label="4–5 days a week, full day (£)"
              inputMode="decimal"
              required
              defaultValue={current ? p2(current.memberHighFullPence) : ''}
            />
            <TextField
              name="halfDayPercent"
              label="Half day (% of full day)"
              inputMode="numeric"
              required
              defaultValue={current?.halfDayPercent ?? 50}
            />
            <TextField
              name="taxi"
              label="Dog taxi (£, 0 = included)"
              inputMode="decimal"
              required
              defaultValue={current ? p2(current.taxiPence) : '0'}
            />
            <TextField
              name="multiDogDiscountPercent"
              label="Second and further dogs discount (%)"
              inputMode="numeric"
              required
              defaultValue={current?.multiDogDiscountPercent ?? 0}
            />
          </div>
          <div>
            <SubmitButton>Schedule prices</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </Stack>
  );
}
