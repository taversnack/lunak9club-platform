import { NextResponse } from 'next/server';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { AuthorizationError } from '@/server/policy/authorize';
import { ConflictError, NotFoundError } from '@/server/errors';
import { PayLinkPreparingError, PayLinkUnavailableError, resumeCheckoutUrl } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

/** "Pay now" link: sends the customer to their open checkout, or back to bookings if it has ended. */
export async function GET(req: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const base = new URL(req.url);
  const actor = await getActor();
  if (actor.kind === 'anonymous') return NextResponse.redirect(new URL('/sign-in', base));
  try {
    const r = await resumeCheckoutUrl(getDb(), actor, attemptId);
    if (r.url) return NextResponse.redirect(r.url, 303);
    return NextResponse.redirect(new URL(`/account/bookings?payment=${r.reason}`, base), 303);
  } catch (e) {
    if (e instanceof AuthorizationError || e instanceof NotFoundError)
      return new Response('Not found', { status: 404 });
    // Someone else's click is creating the same checkout: a neutral "being prepared" page, never the failure one.
    if (e instanceof PayLinkPreparingError)
      return NextResponse.redirect(new URL('/account/bookings?payment=preparing', base), 303);
    if (e instanceof PayLinkUnavailableError)
      return NextResponse.redirect(new URL('/account/bookings?payment=unavailable', base), 303);
    if (e instanceof ConflictError)
      return NextResponse.redirect(new URL('/account/bookings?payment=expired', base), 303);
    throw e;
  }
}
