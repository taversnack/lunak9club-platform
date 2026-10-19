import { NextResponse } from 'next/server';
import { getPaymentProvider } from '@/infra/payments';
import { asSimulatedProvider } from '@/infra/payments/simulated';
import { seeOtherInApp } from '@/server/redirects';

/*
 * The simulated checkout's buttons (PAYMENTS_DRIVER=simulated only; 404 otherwise). They're plain form
 * POSTs answered with a 303, like Stripe's hosted page, so the browser itself follows the success /
 * cancel URL and then our return route's 303. (A Server Action redirect left the address bar on
 * /api/payments/return, because Next shows the action's redirect target and follows the rest itself.)
 */

export function simulatedOr404() {
  return asSimulatedProvider(getPaymentProvider());
}

export async function finishSimulatedCheckout(params: Promise<{ sessionId: string }>, outcome: 'pay' | 'cancel') {
  const p = simulatedOr404();
  if (!p) return new Response('Not found', { status: 404 });
  const { sessionId } = await params;
  const paid = outcome === 'pay' ? p.pay(sessionId) : null;
  const session = paid ?? p.sessions.get(sessionId);
  if (!session) return seeOtherInApp(outcome === 'pay' ? '/account/bookings?payment=expired' : '/account/bookings');
  // successUrl / cancelUrl are absolute APP_URL addresses we created (appUrl), as Stripe's would be.
  return NextResponse.redirect(paid ? session.successUrl : session.cancelUrl, 303);
}
