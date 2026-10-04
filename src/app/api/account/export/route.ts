import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { AuthorizationError } from '@/server/policy/authorize';
import { NotFoundError } from '@/server/errors';
import { exportMyData } from '@/server/services/privacy';

export const dynamic = 'force-dynamic';

/** The signed-in customer's own data (UK GDPR right of access). */
export async function GET() {
  const actor = await getActor();
  if (actor.kind !== 'user') return new Response('Not found', { status: 404 });
  try {
    const data = await exportMyData(getDb(), actor);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lunak9-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof AuthorizationError || e instanceof NotFoundError)
      return new Response('Not found', { status: 404 });
    throw e;
  }
}
