import { NextResponse } from 'next/server';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { appUrl } from '@/server/notify';
import { signInPathFor } from '@/domain/auth/callback-url';
import { AuthorizationError } from '@/server/policy/authorize';
import { NotFoundError } from '@/server/errors';
import { returnFromCheckout } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

/** Where the card payment page sends the customer back. Confirms the payment if it went through. */
export async function GET(req: Request) {
  // Redirects use APP_URL, not req.url's host (the server's own, e.g. localhost behind a proxy), which
  // could differ from the site's and lose the session cookie.
  const url = new URL(req.url);
  const actor = await getActor();
  // Session lost while on the card page: sign in, then finish confirming the payment here.
  if (actor.kind === 'anonymous') return NextResponse.redirect(appUrl(signInPathFor(url.pathname + url.search)));
  try {
    const target = await returnFromCheckout(
      getDb(),
      actor,
      url.searchParams.get('attempt') ?? '',
      url.searchParams.get('cancelled') === '1',
    );
    return NextResponse.redirect(appUrl(target), 303);
  } catch (e) {
    if (e instanceof AuthorizationError || e instanceof NotFoundError)
      return new Response('Not found', { status: 404 });
    throw e;
  }
}
