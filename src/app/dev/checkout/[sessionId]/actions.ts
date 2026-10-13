'use server';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { getPaymentProvider } from '@/infra/payments';
import { isSimulatedProvider } from '@/infra/payments/simulated';

/** Simulated checkout only (PAYMENTS_DRIVER=simulated). Stands in for Stripe's hosted page. */
function simulated() {
  const p = getPaymentProvider();
  if (!isSimulatedProvider(p)) throw new Error('Not available');
  return p;
}

export async function simulatePayAction(fd: FormData) {
  const p = simulated();
  const id = String(fd.get('sessionId') ?? '');
  const s = p.pay(id);
  const session = s ?? p.sessions.get(id);
  if (!session) redirect('/account/bookings?payment=expired');
  redirect((s ? session.successUrl : `${session.cancelUrl}`) as Route);
}

export async function simulateCancelAction(fd: FormData) {
  const p = simulated();
  const session = p.sessions.get(String(fd.get('sessionId') ?? ''));
  redirect((session?.cancelUrl ?? '/account/bookings') as Route);
}
