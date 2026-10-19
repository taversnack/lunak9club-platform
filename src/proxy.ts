import { NextResponse, type NextRequest } from 'next/server';
import { RETURN_TO_HEADER, returnToFrom } from '@/domain/auth/callback-url';

/**
 * Tells server-side guards which page was asked for. Server components and layouts can't see the
 * request path, so `requirePermission` reads it from this header to send signed-out visitors to
 * `/sign-in?callbackUrl=<that page>`. Any value the client sent is overwritten, never trusted.
 * Server Functions are POSTs to the page they're used on, so they get that page's path too.
 */
export function proxy(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set(RETURN_TO_HEADER, returnToFrom(req.nextUrl.pathname, req.nextUrl.search));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not API routes (they build their own sign-in redirects), Next's assets or files.
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
