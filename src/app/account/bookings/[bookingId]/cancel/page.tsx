import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myBookings } from '@/server/services/bookings';
import { SESSION_LABELS } from '@/domain/booking/rules';
import { formatUkDate } from '@/domain/time';
import { cancelBookingAction } from '../../../actions';

export const metadata: Metadata = { title: 'Cancel booking' };
export const dynamic = 'force-dynamic';

export default async function CancelPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const actor = await requirePermission('account.access');
  const { bookingId } = await params;
  const { upcoming, freeCancellationHours } = await myBookings(getDb(), actor);
  const b = upcoming.find((x) => x.id === bookingId && x.cancellable);
  if (!b) notFound();
  const charged = b.status === 'confirmed' && b.late;
  return (
    <Card>
      <Stack>
        <h1>Cancel this booking?</h1>
        <p>
          <strong>{b.dogName}</strong> – {formatUkDate(b.serviceDate)}, {SESSION_LABELS[b.session]}
          {b.taxi ? ' with taxi' : ''}
        </p>
        {b.status === 'pending_payment' ? (
          <Alert tone="info">
            This hasn’t been paid yet, so there’s nothing to pay. Every place held for the same payment is released.
          </Alert>
        ) : charged ? (
          <Alert tone="warning" title="This day will still be charged">
            It’s less than {freeCancellationHours} hours before the session starts, so there’s no refund.
          </Alert>
        ) : (
          <Alert tone="success">
            No charge – you’re cancelling more than {freeCancellationHours} hours before. If you’ve paid for this day by
            card, it’s refunded to your card{b.kind === 'membership' ? ' once Luna’s K9 Club has checked it' : ''}.
          </Alert>
        )}
        <ActionForm action={cancelBookingAction}>
          <input type="hidden" name="bookingId" value={b.id} />
          <div className={s.row} style={{ justifyContent: 'flex-start' }}>
            <SubmitButton variant="danger" pendingText="Cancelling…">
              Yes, cancel booking
            </SubmitButton>
            <Link href="/account/bookings">No, keep it</Link>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
