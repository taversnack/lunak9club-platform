'use client';
import { createAuthClient } from 'better-auth/react';
import { magicLinkClient } from 'better-auth/client/plugins';
import { safeCallbackPath } from '@/domain/auth/callback-url';

export const authClient = createAuthClient({ plugins: [magicLinkClient()] });

/**
 * Ask for a magic sign-in link (customers only). Always resolves the same way for known and unknown
 * addresses, so the UI should say "if that address has an account, a link is on its way" either way.
 * `callbackUrl` is where the link lands after signing in; anything that isn't a same-origin path
 * becomes /dashboard (the server enforces this too). Errors: 429 when rate-limited.
 */
export async function requestMagicLink(email: string, callbackUrl?: string) {
  return authClient.signIn.magicLink({ email, callbackURL: safeCallbackPath(callbackUrl) });
}
