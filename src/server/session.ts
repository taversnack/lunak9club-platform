import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/infra/auth/auth';
import { getDb } from '@/infra/db/client';
import { getUserRoles } from './roles';
import { authorize, type Actor, type OwnedResource } from './policy/authorize';
import type { Permission } from './policy/permissions';
import { recordAudit } from './audit';

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
 * Page/layout guard: redirects anonymous users to sign-in and renders the
 * access-denied route for signed-in users without the permission. Denials are audited.
 */
export async function requirePermission(permission: Permission, resource?: OwnedResource): Promise<UserActor> {
  const actor = await getActor();
  const decision = authorize(actor, permission, resource);
  if (decision.allowed && actor.kind === 'user') return actor;
  if (actor.kind === 'anonymous' || (!decision.allowed && decision.reason === 'unauthenticated')) redirect('/sign-in');
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
