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
 * The POST came from our own pages: its Origin is APP_URL's, or the browser says Sec-Fetch-Site:
 * same-origin. A cross-site form, a missing Origin without that header, or Origin "null" are refused.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin !== null && origin === new URL(appUrl('/')).origin) return true;
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
  return NextResponse.redirect(paid ? paid.successUrl : session.cancelUrl, 303);
}
