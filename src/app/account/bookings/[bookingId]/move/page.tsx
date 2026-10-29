import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack } from '@/ui/components';
import { ActionForm, RadioGroup, SubmitButton, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myBookings } from '@/server/services/bookings';
import { monthRange } from '@/domain/billing/rules';
import { SESSION_LABELS } from '@/domain/booking/rules';
import { addDays, formatUkDate, londonDate } from '@/domain/time';
import { moveMembershipDayAction } from '../../../actions';

export const metadata: Metadata = { title: 'Move a membership day' };
export const dynamic = 'force-dynamic';

/** D90: moving a regular membership day asks "this occasion only, or all future months?". */
export default async function MovePage({ params }: { params: Promise<{ bookingId: string }> }) {
  const actor = await requirePermission('account.access');
  const { bookingId } = await params;
  const { upcoming, freeCancellationHours } = await myBookings(getDb(), actor);
  const b = upcoming.find((x) => x.id === bookingId && x.kind === 'membership' && x.status === 'confirmed');
  if (!b) notFound();
  const tomorrow = addDays(londonDate(new Date()), 1);
  const { first, last } = monthRange(b.serviceDate.slice(0, 7));
  return (
    <Card>
      <Stack>
        <h1>Move this membership day</h1>
        <p>
          <strong>{b.dogName}</strong> – {formatUkDate(b.serviceDate)}, {SESSION_LABELS[b.session]}
        </p>
        {b.late ? (
          <Alert tone="warning">
            It’s less than {freeCancellationHours} hours before this day starts, so it can’t be moved.
          </Alert>
        ) : (
          <ActionForm action={moveMembershipDayAction}>
            <input type="hidden" name="bookingDogId" value={b.id} />
            <RadioGroup
              name="scope"
              label="Move this occasion only, or all future months?"
              options={[
                { value: 'once', label: 'This occasion only' },
                { value: 'future', label: 'All future months (change my regular days)' },
              ]}
              defaultValue="once"
            />
            <TextField
              name="toDate"
              label="New day (this occasion only)"
              hint={`A day in the same month (by ${formatUkDate(last)}) with space, same session. It’s a straight swap – the price doesn’t change. We approve every move.`}
              type="date"
              min={first > tomorrow ? first : tomorrow}
              max={last}
            />
            <div className={s.row} style={{ justifyContent: 'flex-start' }}>
              <SubmitButton pendingText="Sending…">Continue</SubmitButton>
              <Link href="/account/bookings">Back to bookings</Link>
            </div>
          </ActionForm>
        )}
      </Stack>
    </Card>
  );
}
