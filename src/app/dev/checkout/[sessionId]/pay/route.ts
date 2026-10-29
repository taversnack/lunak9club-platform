import { finishSimulatedCheckout } from '../simulated';

export const dynamic = 'force-dynamic';

/** "Pay with a test card" on the simulated checkout page. */
export async function POST(req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  return finishSimulatedCheckout(req, params, 'pay');
}
