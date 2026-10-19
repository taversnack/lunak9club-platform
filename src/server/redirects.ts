import { NextResponse } from 'next/server';
import { safeCallbackPath, signInPathFor } from '@/domain/auth/callback-url';
import { appUrl } from './notify';

/*
 * Redirects from route handlers. Never build them from `req.url`: under `next start` its origin is
 * always the server's own (localhost:PORT), whatever Host / X-Forwarded-Host say, so customers were
 * sent to localhost.
 */

/**
 * 303 to a page on this site with a relative Location. The browser resolves it against the URL it
 * actually used (the public one), and so does Next's internal fetch when a Server Action redirects to
 * a route handler, which keeps the session cookie (an absolute URL on another origin drops it).
 * Only same-origin paths get through; anything else becomes /dashboard.
 */
export function seeOtherInApp(path: string): Response {
  return new Response(null, { status: 303, headers: { Location: safeCallbackPath(path) } });
}

/** A signed-out visitor: to the sign-in page on APP_URL, coming back to this request's path + query. */
export function toSignIn(req: Request): Response {
  const u = new URL(req.url); // only the path and query are taken from req.url
  return NextResponse.redirect(appUrl(signInPathFor(u.pathname + u.search)));
}
