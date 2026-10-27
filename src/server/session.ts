import 'server-only';
import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/infra/auth/auth';
import { getDb } from '@/infra/db/client';
import { getUserRoles } from './roles';
import { authorize, type Actor, type OwnedResource } from './policy/authorize';
import type { Permission } from './policy/permissions';
import { recordAudit } from './audit';
import { RETURN_TO_HEADER, signInPathFor } from '@/domain/auth/callback-url';

export type UserActor = Extract<Actor, { kind: 'user' }> & { name: string };

/** Resolve the current actor from the session cookie. Roles are always read from the DB. */
export async function getActor(): Promise<UserActor | { kind: 'anonymous' }> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return { kind: 'anonymous' };
  const roles = await getUserRoles(getDb(), session.user.id);
  return {
    kind: 'user',
    userId: session.user.id,
    name: session.user.name,
    roles,
    emailVerified: session.user.emailVerified,
  };
}

/**
 * The sign-in page URL that brings this visitor back to the page they asked for (path + query, from
 * the header `src/proxy.ts` sets). Falls back to a bare `/sign-in` if the header is missing or unsafe.
 */
export async function signInRedirectPath(): Promise<Route> {
  return signInPathFor((await headers()).get(RETURN_TO_HEADER) ?? '') as Route;
}

/**
 * Page/layout guard: redirects anonymous users to sign-in (coming back to the page they asked for)
 * and renders the access-denied route for signed-in users without the permission. Denials are audited.
 */
export async function requirePermission(permission: Permission, resource?: OwnedResource): Promise<UserActor> {
  const actor = await getActor();
  const decision = authorize(actor, permission, resource);
  if (decision.allowed && actor.kind === 'user') return actor;
  if (actor.kind === 'anonymous' || (!decision.allowed && decision.reason === 'unauthenticated'))
    redirect(await signInRedirectPath());
  if (!decision.allowed && decision.reason === 'unverified') redirect('/verify-email');
  await recordAudit(getDb(), {
    actor,
    action: 'authz.denied',
    entityType: 'permission',
    entityId: permission,
    outcome: 'denied',
  });
  redirect('/access-denied');
}
