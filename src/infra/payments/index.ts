import { env } from '../env';
import { SimulatedPaymentProvider } from './simulated';
import { StripePaymentProvider } from './stripe';
import type { PaymentProvider } from './types';

export type { PaymentProvider } from './types';

/** Live keys only in production; anything that isn't a Stripe key is refused (non-negotiable 7). */
export function checkStripeKey(key: string, appEnv: string): 'test' | 'live' {
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]/.test(key))
    throw new Error('STRIPE_SECRET_KEY does not look like a Stripe key');
  const live = /^(sk|rk)_live_/.test(key);
  if (live && appEnv !== 'production') throw new Error('Refusing to use a live Stripe key outside production');
  return live ? 'live' : 'test';
}

const g = globalThis as unknown as { __lk9Payments?: PaymentProvider };
let override: PaymentProvider | undefined;

/**
 * The configured payment provider. Live Stripe keys are refused outside production, and
 * production refuses the simulated driver (CLAUDE.md non-negotiable 7).
 */
export function getPaymentProvider(): PaymentProvider {
  if (override) return override;
  if (g.__lk9Payments) return g.__lk9Payments;
  const e = env();
  let p: PaymentProvider;
  if (e.PAYMENTS_DRIVER === 'stripe') {
    const key = e.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    checkStripeKey(key, e.APP_ENV);
    p = new StripePaymentProvider(key, e.STRIPE_WEBHOOK_SECRET);
  } else {
    if (e.APP_ENV === 'production') throw new Error('Production needs PAYMENTS_DRIVER=stripe');
    p = new SimulatedPaymentProvider(e.APP_URL.replace(/\/$/, ''));
  }
  // Kept on globalThis so the simulated sessions survive module reloads in development.
  g.__lk9Payments = p;
  return p;
}

/** Tests only. */
export function setPaymentProvider(p: PaymentProvider | undefined) {
  override = p;
}
