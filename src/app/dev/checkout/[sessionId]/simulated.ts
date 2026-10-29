import { NextResponse } from 'next/server';
import { getPaymentProvider } from '@/infra/payments';
import { asSimulatedProvider } from '@/infra/payments/simulated';
import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { appUrl } from '@/server/notify';
import { seeOtherInApp } from '@/server/redirects';
import { NotFoundError } from '@/server/errors';
import { mySimulatedCheckout } from '@/server/services/payments';

/*
 * The simulated checkout's buttons (PAYMENTS_DRIVER=simulated only; 404 otherwise). They're plain form
 * POSTs answered with a 303, like Stripe's hosted page, so the browser itself follows the success /
 * cancel URL and then our return route's 303. (A Server Action redirect left the address bar on
 * /api/payments/return, because Next shows the action's redirect target and follows the rest itself.)
 *
 * Plain POSTs don't get Server Actions' built-in Origin check, so it's done here (sameOrigin), and
 * only the signed-in customer whose checkout it is may use it (everyone else gets 404).
 */

export function simulatedOr404() {
  return asSimulatedProvider(getPaymentProvider());
}

/**
 * The POST came from our own pages. If the browser sent an Origin, it must be APP_URL's (so a foreign
 * Origin or "null" is refused, whatever Sec-Fetch-Site says). With no Origin, Sec-Fetch-Site must be
 * same-origin; a missing Origin with any other (or no) Sec-Fetch-Site is refused.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin !== null) return origin === new URL(appUrl('/')).origin;
  return req.headers.get('sec-fetch-site') === 'same-origin';
}

export async function finishSimulatedCheckout(
  req: Request,
  params: Promise<{ sessionId: string }>,
  outcome: 'pay' | 'cancel',
) {
  const p = simulatedOr404();
  if (!p) return new Response('Not found', { status: 404 });
  if (!sameOrigin(req)) return new Response('Forbidden', { status: 403 });
  const { sessionId } = await params;
  try {
    await mySimulatedCheckout(getDb(), await getActor(), sessionId);
  } catch (e) {
    if (e instanceof NotFoundError) return new Response('Not found', { status: 404 });
    throw e;
  }
  const session = p.sessions.get(sessionId);
  if (!session) return seeOtherInApp(outcome === 'pay' ? '/account/bookings?payment=expired' : '/account/bookings');
  // Paid already (a replay or double-click): back to the return page, which says it's already paid.
  if (session.status === 'complete') return NextResponse.redirect(`${session.successUrl}&again=1`, 303);
  const paid = outcome === 'pay' ? p.pay(sessionId) : null;
  // successUrl / cancelUrl are absolute APP_URL addresses we created (appUrl), as Stripe's would be.
  if (paid) return NextResponse.redirect(paid.successUrl, 303);
  // Lost a race with another click that paid it while we checked ownership: it's paid, so say so.
  if (outcome === 'pay' && p.sessions.get(sessionId)?.status === 'complete')
    return NextResponse.redirect(`${session.successUrl}&again=1`, 303);
  return NextResponse.redirect(session.cancelUrl, 303);
}
