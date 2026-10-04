import { getDb } from '@/infra/db/client';
import { logger } from '@/infra/logger';
import { handleWebhook } from '@/server/services/payments';

export const dynamic = 'force-dynamic';

/**
 * Stripe webhooks. No session: authenticity comes from the Stripe-Signature header, verified
 * against STRIPE_WEBHOOK_SECRET before anything is read. Errors return 500 so Stripe retries.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get('stripe-signature');
  let result: { duplicate: boolean };
  try {
    result = await handleWebhook(getDb(), raw, signature);
  } catch (err) {
    const bad = err instanceof Error && /signature|No signatures|STRIPE_WEBHOOK_SECRET|webhooks/i.test(err.message);
    logger.warn({ err: err instanceof Error ? err.name : 'unknown' }, bad ? 'webhook rejected' : 'webhook failed');
    return new Response(bad ? 'Invalid signature' : 'Error', { status: bad ? 400 : 500 });
  }
  return Response.json({ received: true, duplicate: result.duplicate });
}
