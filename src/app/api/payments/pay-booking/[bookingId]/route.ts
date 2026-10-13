import { NextResponse } from 'next/server';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { AuthorizationError } from '@/server/policy/authorize';
import { ConflictError, NotFoundError } from '@/server/errors';
import { payForMyBooking } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

/** "Pay now" for a held booking: opens the existing checkout or creates one on demand. */
export async function GET(req: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const base = new URL(req.url);
  const actor = await getActor();
  if (actor.kind === 'anonymous') return NextResponse.redirect(new URL('/sign-in', base));
  try {
    const r = await payForMyBooking(getDb(), actor, bookingId);
    if (r.url) return NextResponse.redirect(r.url, 303);
    return NextResponse.redirect(new URL(`/account/bookings?payment=${r.reason}`, base), 303);
  } catch (e) {
    if (e instanceof AuthorizationError || e instanceof NotFoundError)
      return new Response('Not found', { status: 404 });
    if (e instanceof ConflictError)
      return NextResponse.redirect(new URL('/account/bookings?payment=unavailable', base), 303);
    throw e;
  }
}
