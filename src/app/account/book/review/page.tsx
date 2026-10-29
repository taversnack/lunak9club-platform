import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, SubmitButton, TextArea } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { previewMyBookings } from '@/server/services/bookings';
import { customerBookingInput } from '@/domain/booking/customer-request';
import { ValidationError } from '@/server/errors';
import { FocusOnMount } from '@/ui/focus-on-mount';
import { formatPounds, SESSION_LABELS } from '@/domain/booking/rules';
import { formatUkDate } from '@/domain/time';
import { REQUEST_NOT_SECURED } from '@/domain/booking/wording';
import { confirmBookingAction } from '../../actions';

export const metadata: Metadata = { title: 'Check your booking' };
export const dynamic = 'force-dynamic';

const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermission('account.access');
  const sp = await searchParams;
  // Full days only, the taxi is included for everyone, and a full day goes on the waitlist.
  const input = customerBookingInput({ dogIds: list(sp.dog), dates: list(sp.date), trial: sp.trial === '1' });
  let preview;
  try {
    preview = await previewMyBookings(getDb(), actor, input);
  } catch (e) {
    if (e instanceof ValidationError) {
      return (
        <Stack>
          <h1>Check your booking</h1>
          <FocusOnMount>
            <Alert tone="danger" title="This can’t be booked as it is">
              <ul>
                {Object.values(e.fields).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          </FocusOnMount>
          <p>
            <Link href="/account/book">Go back and change your choices</Link>
          </p>
        </Stack>
      );
    }
    throw e;
  }
  const { lines, request } = preview;
  const confirmed = lines.filter((l) => l.outcome === 'requested');
  const outcome = {
    requested: { tone: 'success' as const, text: 'Place available – will be requested' },
    waitlisted: { tone: 'warning' as const, text: 'Full – waitlist' },
    skipped: { tone: 'info' as const, text: 'Won’t be booked' },
  };
  return (
    <Stack>
      <p className={s.breadcrumb}>
        <Link href="/account/book">Book day care</Link> › Check your booking
      </p>
      <h1>Check your booking request</h1>
      <Card aria-labelledby="summary">
        <h2 id="summary">{SESSION_LABELS[request.session as 'full']}</h2>
        <div className={s.tableWrap} role="region" aria-label="Booking summary" tabIndex={0}>
          <table className={`${s.table} ${s.stackTable}`}>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Dog</th>
                <th scope="col">What will happen</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={`${l.date}-${l.dogId}`}>
                  <td data-primary="">{formatUkDate(l.date)}</td>
                  <td data-label="Dog">{l.dogName}</td>
                  <td data-label="What will happen">
                    <StatusBadge tone={outcome[l.outcome].tone}>{outcome[l.outcome].text}</StatusBadge>
                    {l.reason && l.outcome === 'skipped' ? <span className={s.hint}> {l.reason}</span> : null}
                  </td>
                  <td data-label="Price">
                    {l.price && l.outcome !== 'skipped' ? (
                      <>
                        {formatPounds(l.price.totalPence)}
                        <div className={s.hint}>{l.price.explanation}</div>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Total for {confirmed.length} requested {confirmed.length === 1 ? 'day' : 'days'}:{' '}
          <span className={s.total}>{formatPounds(preview.totalPence)}</span>
        </p>
        <p className={s.hint}>
          Prices are fixed when you send the request. Nothing is charged now: once Luna’s K9 Club approves, we email you
          a link to pay by card, and the place is held until the time shown in that email. Waitlisted days are only
          charged if we give you a place. Cancel {preview.freeCancellationHours} hours or more before the session starts
          for a full refund to your card; later cancellations and no-shows are charged in full.
        </p>
      </Card>
      {confirmed.length === 0 && !lines.some((l) => l.outcome === 'waitlisted') ? (
        <Alert tone="info">
          Nothing here can be booked. <Link href="/account/book">Choose other dates</Link>.
        </Alert>
      ) : (
        <ActionForm action={confirmBookingAction}>
          {request.dogIds.map((d) => (
            <input key={d} type="hidden" name="dog" value={d} />
          ))}
          {request.dates.map((d) => (
            <input key={d} type="hidden" name="date" value={d} />
          ))}
          <input type="hidden" name="session" value={request.session} />
          <input type="hidden" name="trial" value={request.trial ? '1' : '0'} />
          {confirmed.length ? (
            <Alert tone="warning" title="Your booking isn’t secured yet">
              <p data-testid="request-not-secured">{REQUEST_NOT_SECURED}</p>
            </Alert>
          ) : null}
          <TextArea name="customerNote" label="Anything we should know for these days?" rows={2} />
          <div className={s.row} style={{ justifyContent: 'flex-start' }}>
            <SubmitButton pendingText="Sending…">
              {confirmed.length ? 'Send booking request' : 'Join the waitlist'}
            </SubmitButton>
            <Link href="/account/book">Change</Link>
          </div>
        </ActionForm>
      )}
    </Stack>
  );
}
