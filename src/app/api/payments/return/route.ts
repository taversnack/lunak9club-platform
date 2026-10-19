import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { seeOtherInApp, toSignIn } from '@/server/redirects';
import { AuthorizationError } from '@/server/policy/authorize';
import { NotFoundError } from '@/server/errors';
import { returnFromCheckout } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

/** Where the card payment page sends the customer back. Confirms the payment if it went through. */
export async function GET(req: Request) {
  const url = new URL(req.url); // only its query is read; redirects never use its origin
  const actor = await getActor();
  // Session lost while on the card page: sign in, then finish confirming the payment here.
  if (actor.kind === 'anonymous') return toSignIn(req);
  try {
    const target = await returnFromCheckout(
      getDb(),
      actor,
      url.searchParams.get('attempt') ?? '',
      url.searchParams.get('cancelled') === '1',
    );
    return seeOtherInApp(target);
  } catch (e) {
    if (e instanceof AuthorizationError || e instanceof NotFoundError)
      return new Response('Not found', { status: 404 });
    throw e;
  }
}
