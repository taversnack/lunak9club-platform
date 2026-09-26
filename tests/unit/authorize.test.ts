import { describe, expect, it } from 'vitest';
import { authorize, assertAuthorized, AuthorizationError, type Actor } from '@/server/policy/authorize';
import { permissionsFor, PERMISSIONS, ROLE_PERMISSIONS } from '@/server/policy/permissions';

const owner: Actor = { kind: 'user', userId: 'o1', roles: ['owner'], emailVerified: true };
const customerA: Actor = { kind: 'user', userId: 'a1', roles: ['customer'], emailVerified: true };
const unverified: Actor = { kind: 'user', userId: 'u1', roles: ['customer'], emailVerified: false };
const anon: Actor = { kind: 'anonymous' };

describe('authorize', () => {
  it('denies anonymous users every permission', () => {
    for (const p of PERMISSIONS) expect(authorize(anon, p)).toEqual({ allowed: false, reason: 'unauthenticated' });
  });

  it('denies unverified users even with a role', () => {
    expect(authorize(unverified, 'account.access')).toEqual({ allowed: false, reason: 'unverified' });
  });

  it('lets the owner into the admin area and customers into their account only', () => {
    expect(authorize(owner, 'admin.access').allowed).toBe(true);
    expect(authorize(customerA, 'admin.access')).toEqual({ allowed: false, reason: 'forbidden' });
    expect(authorize(customerA, 'account.access').allowed).toBe(true);
    expect(authorize(customerA, 'audit.read').allowed).toBe(false);
  });

  it('scopes self permissions to the owner of the record', () => {
    expect(authorize(customerA, 'customer.self.read', { ownerUserId: 'a1' }).allowed).toBe(true);
    expect(authorize(customerA, 'customer.self.read', { ownerUserId: 'b1' })).toEqual({
      allowed: false,
      reason: 'forbidden',
    });
    expect(authorize(customerA, 'customer.self.update')).toEqual({ allowed: false, reason: 'forbidden' });
  });

  it('grants nothing for unknown roles', () => {
    const odd: Actor = { kind: 'user', userId: 'x', roles: ['superadmin', 'root'], emailVerified: true };
    for (const p of PERMISSIONS) expect(authorize(odd, p).allowed).toBe(false);
    expect(permissionsFor(['superadmin']).size).toBe(0);
  });

  it('allows system jobs', () => {
    expect(authorize({ kind: 'system', job: 'test' }, 'audit.read').allowed).toBe(true);
  });

  it('throws a typed error from assertAuthorized', () => {
    expect(() => assertAuthorized(customerA, 'admin.access')).toThrow(AuthorizationError);
  });

  it('only references defined permissions in the role map', () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) for (const p of perms) expect(PERMISSIONS).toContain(p);
  });
});
