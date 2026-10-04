import { getDb } from '@/infra/db/client';
import { getActor } from '@/server/session';
import { AuthorizationError } from '@/server/policy/authorize';
import { NotFoundError } from '@/server/errors';
import { invoicePdf } from '@/server/services/invoice-document';

export const dynamic = 'force-dynamic';

/** Invoice PDF. Authorised in the service (Owner, or the invoice's own customer). */
export async function GET(_req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const actor = await getActor();
  try {
    const { bytes, filename } = await invoicePdf(getDb(), actor, invoiceId);
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '')}"`,
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
