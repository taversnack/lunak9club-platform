import { eq } from 'drizzle-orm';
import type { Db } from '../../src/infra/db/client';
import { checkoutAttempts } from '../../src/infra/db/schema';
import { getPaymentProvider } from '../../src/infra/payments';
import { SimulatedPaymentProvider } from '../../src/infra/payments/simulated';
import { completeCheckout } from '../../src/server/services/payments';

export function simulated(): SimulatedPaymentProvider {
  const p = getPaymentProvider();
  if (!(p instanceof SimulatedPaymentProvider)) throw new Error('Tests expect PAYMENTS_DRIVER=simulated');
  return p;
}

/** Pay every open checkout with a "test card" and confirm it, as the customer returning would. */
export async function payOpenCheckouts(db: Db, now = new Date()) {
  const open = await db.select().from(checkoutAttempts).where(eq(checkoutAttempts.status, 'open'));
  for (const a of open) {
    if (!a.providerSessionId) continue;
    simulated().pay(a.providerSessionId);
    await completeCheckout(db, a.id, now);
  }
  return open.length;
}
