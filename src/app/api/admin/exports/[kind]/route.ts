import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { AuthorizationError } from '@/server/policy/authorize';
import { attendanceCsv, emergencyCsv } from '@/server/services/owner-bookings';
import { isIsoDate } from '@/domain/time';
import { invoicesCsv } from '@/server/services/billing';
import { NotFoundError } from '@/server/errors';

export const dynamic = 'force-dynamic';

/** Owner-only CSV downloads for a day. Authorised in the service; every download is audited. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const sp = new URL(req.url).searchParams;
  const date = sp.get('date') ?? '';
  const month = sp.get('month') ?? '';
  const ok =
    kind === 'invoices'
      ? /^\d{4}-\d{2}$/.test(month)
      : isIsoDate(date) && (kind === 'attendance' || kind === 'emergency');
  if (!ok) return new Response('Not found', { status: 404 });
  const actor = await getActor();
  try {
    const body =
      kind === 'invoices'
        ? await invoicesCsv(getDb(), actor, month)
        : kind === 'attendance'
          ? await attendanceCsv(getDb(), actor, date)
          : await emergencyCsv(getDb(), actor, date);
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="lunak9-${kind}-${kind === 'invoices' ? month : date}.csv"`,
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
