import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { AuthorizationError } from '@/server/policy/authorize';
import { attendanceCsv, emergencyCsv } from '@/server/services/owner-bookings';
import { isIsoDate } from '@/domain/time';

export const dynamic = 'force-dynamic';

/** Owner-only CSV downloads for a day. Authorised in the service; every download is audited. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const date = new URL(req.url).searchParams.get('date') ?? '';
  if (!isIsoDate(date) || (kind !== 'attendance' && kind !== 'emergency'))
    return new Response('Not found', { status: 404 });
  const actor = await getActor();
  try {
    const body =
      kind === 'attendance' ? await attendanceCsv(getDb(), actor, date) : await emergencyCsv(getDb(), actor, date);
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lunak9-${kind}-${date}.csv"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    if (e instanceof AuthorizationError) return new Response('Not found', { status: 404 });
    throw e;
  }
}
