import { NextResponse } from 'next/server';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { seeOtherInApp, toSignIn } from '@/server/redirects';
import { AuthorizationError } from '@/server/policy/authorize';
import { NotFoundError } from '@/server/errors';
import { PayLinkBusyError, PayLinkUnavailableError, resumeCheckoutUrl } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

/** "Pay now" link: sends the customer to their open checkout, or back to bookings if it has ended. */
export async function GET(req: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const actor = await getActor();
  // Signed out (e.g. tapped the emailed pay link): sign in, then come straight back here.
  if (actor.kind === 'anonymous') return toSignIn(req);
  try {
    const r = await resumeCheckoutUrl(getDb(), actor, attemptId);
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
