import { permissionsFor, SELF_SCOPED_PERMISSIONS, type Permission } from './permissions';

export type Actor =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string; roles: readonly string[]; emailVerified: boolean }
  | { kind: 'system'; job: string };

/** A resource owned by a specific user (customer records, dogs, invoices…). */
export type OwnedResource = { ownerUserId: string };

export type Decision = { allowed: true } | { allowed: false; reason: 'unauthenticated' | 'unverified' | 'forbidden' };

/**
 * The only permission check in the application. Every server action, route handler,
 * query helper, storage URL and job must call this (or assertAuthorized) — never rely on UI hiding.
 */
export function authorize(actor: Actor, permission: Permission, resource?: OwnedResource): Decision {
  if (actor.kind === 'system') return { allowed: true };
  if (actor.kind === 'anonymous') return { allowed: false, reason: 'unauthenticated' };
  if (!actor.emailVerified) return { allowed: false, reason: 'unverified' };

  const granted = permissionsFor(actor.roles);
  if (!granted.has(permission)) return { allowed: false, reason: 'forbidden' };

  if (SELF_SCOPED_PERMISSIONS.has(permission)) {
    if (!resource || resource.ownerUserId !== actor.userId) return { allowed: false, reason: 'forbidden' };
  }
  return { allowed: true };
}

export class AuthorizationError extends Error {
  constructor(
    public readonly reason: 'unauthenticated' | 'unverified' | 'forbidden',
    public readonly permission: Permission,
  ) {
    super(`Not authorised: ${reason}`);
    this.name = 'AuthorizationError';
  }
}

/** True if the actor holds the permission at all (ignoring ownership). Use to choose a code path, then call authorize(). */
export function hasPermission(actor: Actor, permission: Permission): boolean {
  if (actor.kind === 'system') return true;
  if (actor.kind !== 'user' || !actor.emailVerified) return false;
  return permissionsFor(actor.roles).has(permission);
}

export function assertAuthorized(actor: Actor, permission: Permission, resource?: OwnedResource): void {
  const d = authorize(actor, permission, resource);
  if (!d.allowed) throw new AuthorizationError(d.reason, permission);
}
