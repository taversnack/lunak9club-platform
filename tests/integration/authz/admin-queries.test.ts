import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/infra/db/client';
import { listRecentAuditEvents } from '@/server/queries/audit';
import { AuthorizationError, type Actor } from '@/server/policy/authorize';
import { grantRole, getUserRoles, revokeRole } from '@/server/roles';
import { users } from '@/infra/db/schema';
import { sql } from 'drizzle-orm';

afterAll(closeDb);

const owner: Actor = { kind: 'user', userId: 'owner-x', roles: ['owner'], emailVerified: true };
const customer: Actor = { kind: 'user', userId: 'cust-x', roles: ['customer'], emailVerified: true };

describe('server-side authorisation on queries', () => {
  it('lets the owner read the audit trail', async () => {
    await expect(listRecentAuditEvents(getDb(), owner)).resolves.toBeInstanceOf(Array);
  });

  it('refuses customers and anonymous callers', async () => {
    await expect(listRecentAuditEvents(getDb(), customer)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listRecentAuditEvents(getDb(), { kind: 'anonymous' })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('never exposes audit metadata or actor ids through the admin query', async () => {
    const rows = await listRecentAuditEvents(getDb(), owner, 5);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(['action', 'actorType', 'entityType', 'id', 'occurredAt', 'outcome']);
    }
  });
});

describe('role changes', () => {
  it('grants and revokes idempotently with an audit entry each time it changes', async () => {
    const db = getDb();
    await db
      .insert(users)
      .values({ id: 'role-test', name: 'Role Test', email: 'role.test@example.test', emailVerified: true });
    const sys = { kind: 'system', job: 'test' } as const;
    await grantRole(db, sys, 'role-test', 'owner');
    await grantRole(db, sys, 'role-test', 'owner');
    expect(await getUserRoles(db, 'role-test')).toEqual(['owner']);
    await revokeRole(db, sys, 'role-test', 'owner');
    expect(await getUserRoles(db, 'role-test')).toEqual([]);
    const a = await db.execute<{ action: string }>(
      sql`select action from audit_events where entity_id = 'role-test' order by id`,
    );
    expect(a.rows.map((r) => r.action)).toEqual(['role.granted', 'role.revoked']);
  });
});
