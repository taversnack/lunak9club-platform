import { finishSimulatedCheckout } from '../simulated';

export const dynamic = 'force-dynamic';

/** "Cancel" on the simulated checkout page. */
export async function POST(_req: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  return finishSimulatedCheckout(params, 'cancel');
}
