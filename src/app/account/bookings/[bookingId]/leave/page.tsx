import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { ActionForm, SubmitButton } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myBookings } from '@/server/services/bookings';
import { SESSION_LABELS } from '@/domain/booking/rules';
import { formatUkDate } from '@/domain/time';
import { leaveWaitlistAction } from '../../../actions';

export const metadata: Metadata = { title: 'Leave the waitlist' };
export const dynamic = 'force-dynamic';

/** Leave the waitlist (D81). Allowed any time, including on the day. */
export default async function LeaveWaitlistPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const actor = await requirePermission('account.access');
  const { bookingId } = await params;
  const { upcoming } = await myBookings(getDb(), actor);
  const b = upcoming.find((x) => x.id === bookingId && x.leavable);
  if (!b) notFound();
  return (
    <Card>
      <Stack>
        <h1>Leave the waitlist?</h1>
        <p>
          <strong>{b.dogName}</strong> – {formatUkDate(b.serviceDate)}, {SESSION_LABELS[b.session]}
          {b.taxi ? ' with taxi' : ''}
        </p>
        <p>We won’t be able to give you a place for this day. There’s no charge.</p>
        <ActionForm action={leaveWaitlistAction}>
          <input type="hidden" name="bookingId" value={b.id} />
          <div className={s.row} style={{ justifyContent: 'flex-start' }}>
            <SubmitButton variant="danger" pendingText="Saving…">
              Yes, leave the waitlist
            </SubmitButton>
            <Link href="/account/bookings">No, go back</Link>
          </div>
        </ActionForm>
      </Stack>
    </Card>
  );
}
