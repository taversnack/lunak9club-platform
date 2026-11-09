import { NextResponse, type NextRequest } from 'next/server';
import { RETURN_TO_HEADER, returnToFrom } from '@/domain/auth/callback-url';
import { buildCsp } from '@/domain/security/csp';

/**
 * Tells server-side guards which page was asked for. Server components and layouts can't see the
 * request path, so `requirePermission` reads it from this header to send signed-out visitors to
 * `/sign-in?callbackUrl=<that page>`. Any value the client sent is overwritten, never trusted: the
 * proxy runs on every request that can reach a guard, including paths that look like files
 * (`/account/dogs/x.json`) and API routes. Server Functions are POSTs to the page they're used on,
 * so they get that page's path too.
 */
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set(RETURN_TO_HEADER, returnToFrom(req.nextUrl.pathname, req.nextUrl.search));
  // A fresh nonce per request. Next.js reads it from the request's Content-Security-Policy header and puts it on
  // its own inline scripts; the same policy goes on the response. Every page here is rendered per request, which
  // a nonce needs.
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp({
    nonce,
    development: process.env.NODE_ENV === 'development',
    secure: process.env.NODE_ENV === 'production' && req.nextUrl.protocol === 'https:',
  });
  headers.set('Content-Security-Policy', csp);
  headers.set('x-nonce', nonce);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // Everything except Next's build assets, image optimiser and the favicon, which never reach a guard
  // (and are most of the static traffic). Don't skip "files" by extension: page paths can end in
  // .<ext> too, and a skipped path would let a client-sent header through to the guard.
  matcher: ['/((?!_next/static/|_next/image|favicon\\.ico$).*)'],
};
