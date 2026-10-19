import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import s from '@/ui/ui.module.css';
import { Alert, buttonClass, Card, Stack } from '@/ui/components';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { NotFoundError } from '@/server/errors';
import { mySimulatedCheckout } from '@/server/services/payments';
import { simulatedOr404 } from './simulated';
import { pounds } from '@/domain/pricing/engine';

export const metadata: Metadata = { title: 'Test card payment' };
export const dynamic = 'force-dynamic';

/** Stand-in for Stripe's payment page when PAYMENTS_DRIVER=simulated. 404 otherwise. */
export default async function SimulatedCheckoutPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const p = simulatedOr404();
  if (!p) notFound();
  // Only the customer whose checkout it is can see it (it shows what's being paid for).
  const mine = await mySimulatedCheckout(getDb(), await getActor(), sessionId).catch((e: unknown) => {
    if (e instanceof NotFoundError) return null;
    throw e;
  });
  const session = p.sessions.get(sessionId);
  if (!mine || !session) notFound();
  const state = await p.getCheckout(sessionId);
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Stack>
        <h1>Test card payment</h1>
        <Alert tone="warning" title="Simulated payment">
          This is a pretend payment page for testing. No money moves. With Stripe switched on, customers see Stripe’s
          secure card page here instead.
        </Alert>
        <Card aria-labelledby="summary">
          <h2 id="summary">{pounds(session.amountPence)}</h2>
          <p>{session.description}</p>
          {state.status === 'open' ? (
            <div className={s.row}>
              {/* Plain POSTs (not Server Actions), so the browser follows the redirects, as from Stripe. */}
              <form method="post" action={`/dev/checkout/${encodeURIComponent(sessionId)}/pay`}>
                <button type="submit" className={buttonClass('primary')}>
                  Pay {pounds(session.amountPence)} with a test card
                </button>
              </form>
              <form method="post" action={`/dev/checkout/${encodeURIComponent(sessionId)}/cancel`}>
                <button type="submit" className={buttonClass('secondary')}>
                  Cancel
                </button>
              </form>
            </div>
          ) : (
            <p>This payment is {state.status === 'complete' ? 'already complete' : 'no longer available'}.</p>
          )}
        </Card>
      </Stack>
    </div>
  );
}
