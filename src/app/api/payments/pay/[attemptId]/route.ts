import { NextResponse } from 'next/server';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { AuthorizationError } from '@/server/policy/authorize';
import { NotFoundError } from '@/server/errors';
import { resumeCheckoutUrl } from '@/server/services/payments';

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
    throw e;
  }
}
