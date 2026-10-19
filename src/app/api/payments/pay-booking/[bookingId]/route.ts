import { NextResponse } from 'next/server';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { appUrl } from '@/server/notify';
import { signInPathFor } from '@/domain/auth/callback-url';
import { AuthorizationError } from '@/server/policy/authorize';
import { ConflictError, NotFoundError } from '@/server/errors';
import { PayLinkBusyError, payForMyBooking } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

/** "Pay now" for a held booking: opens the existing checkout or creates one on demand. */
export async function GET(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  // Only the requested path is read from req.url. Redirects use APP_URL, because req.url's host is the
  // server's own (e.g. localhost behind a proxy), which could differ from the site's and lose the session cookie.
  const base = new URL(req.url);
  const actor = await getActor();
  // Signed out (e.g. tapped the emailed pay link): sign in, then come straight back here.
  if (actor.kind === 'anonymous') return NextResponse.redirect(appUrl(signInPathFor(base.pathname + base.search)));
  try {
    const r = await payForMyBooking(getDb(), actor, bookingId);
    if (r.url) return NextResponse.redirect(r.url, 303);
    return NextResponse.redirect(appUrl(`/account/bookings?payment=${r.reason}`), 303);
  } catch (e) {
    if (e instanceof AuthorizationError || e instanceof NotFoundError)
      return new Response('Not found', { status: 404 });
    if (e instanceof PayLinkBusyError) return NextResponse.redirect(appUrl('/account/bookings?payment=preparing'), 303);
    if (e instanceof ConflictError) return NextResponse.redirect(appUrl('/account/bookings?payment=unavailable'), 303);
    throw e;
  }
}
