import { getDb } from '@/infra/db/client';
import { getStorage } from '@/infra/storage';
import { getActor } from '@/server/session';
import { NotFoundError } from '@/server/errors';
import { authoriseDocumentDownload } from '@/server/services/documents';

export const dynamic = 'force-dynamic';

/** Permission-checked, audited document download. S3 → 60-second signed URL; filesystem → streamed. */
export async function GET(_req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const actor = await getActor();
  try {
    const doc = await authoriseDocumentDownload(getDb(), actor, documentId);
    const storage = getStorage();
    const headers = {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Referrer-Policy': 'no-referrer',
    };
    const signed = await storage.signedDownloadUrl(doc.storageKey, {
      expiresInSeconds: 60,
      filename: doc.displayName,
      contentType: doc.contentType,
    });
    if (signed) return new Response(null, { status: 302, headers: { ...headers, Location: signed } });
    const bytes = await storage.get(doc.storageKey);
    const safeName = doc.displayName.replace(/[^\w.\- ]+/g, '_');
    return new Response(Buffer.from(bytes), {
      headers: {
        ...headers,
        'Content-Type': doc.contentType,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `inline; filename="${safeName}"`,
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response('Not found', { status: 404 });
    throw e;
  }
}
