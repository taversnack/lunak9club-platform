import { NextResponse } from 'next/server';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { seeOtherInApp, toSignIn } from '@/server/redirects';
import { AuthorizationError } from '@/server/policy/authorize';
import { NotFoundError } from '@/server/errors';
import { PayLinkBusyError, PayLinkUnavailableError, payForMyBooking } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

/** "Pay now" for a held booking: opens the existing checkout or creates one on demand. */
export async function GET(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const actor = await getActor();
  // Signed out (e.g. tapped the emailed pay link): sign in, then come straight back here.
  if (actor.kind === 'anonymous') return toSignIn(req);
  try {
    const r = await payForMyBooking(getDb(), actor, bookingId);
    if (r.to === null) return NextResponse.redirect(r.url, 303);
    return seeOtherInApp(r.to);
  } catch (e) {
    if (e instanceof AuthorizationError || e instanceof NotFoundError)
      return new Response('Not found', { status: 404 });
    if (e instanceof PayLinkBusyError) return seeOtherInApp('/account/bookings?payment=preparing');
    if (e instanceof PayLinkUnavailableError) return seeOtherInApp('/account/bookings?payment=unavailable');
    throw e;
  }
}
