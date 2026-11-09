import { getDb } from '@/infra/db/client';
import { getStorage } from '@/infra/storage';
import { getActor } from '@/server/session';
import { NotFoundError } from '@/server/errors';
import { authoriseDocumentDownload, UnscannedAcknowledgementRequired } from '@/server/services/documents';

export const dynamic = 'force-dynamic';

/** Permission-checked, audited document download. S3 → 60-second signed URL; filesystem → streamed. */
export async function GET(req: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const actor = await getActor();
  try {
    const acknowledgeUnscanned = new URL(req.url).searchParams.get('acknowledge') === 'unscanned';
    const doc = await authoriseDocumentDownload(getDb(), actor, documentId, { acknowledgeUnscanned });
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
    if (e instanceof UnscannedAcknowledgementRequired) return unscannedWarning(documentId);
    throw e;
  }
}

/**
 * Shown instead of a file the virus scanner hasn't checked yet (held, D30/D109). Only the Owner reaches this
 * (anyone else gets the usual not-found). "Open anyway" repeats the request with the acknowledgement, which
 * the server audits as document.opened_unscanned.
 */
function unscannedWarning(documentId: string) {
  const href = `/api/documents/${encodeURIComponent(documentId)}?acknowledge=unscanned`;
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>File not checked yet</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem"><main><h1>This file hasn’t been checked yet</h1><p>The virus scanner wasn’t available when this file was uploaded, so it hasn’t been checked. Only open it if you expect it.</p><p><a href="${href}">Open anyway</a></p><p><a href="/admin">Back to the Owner area</a></p></main></body></html>`;
  return new Response(html, {
    status: 409,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
