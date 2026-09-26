import 'server-only';
import { and, eq } from 'drizzle-orm';
import { userRoles } from '@/infra/db/schema';
import type { Db } from '@/infra/db/client';
import type { RoleKey } from './policy/permissions';
import { recordAudit } from './audit';
import type { Actor } from './policy/authorize';

export async function getUserRoles(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select({ roleKey: userRoles.roleKey }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.roleKey);
}

/** Grant a role and audit it in one transaction. Idempotent. */
export async function grantRole(db: Db, by: Actor, userId: string, role: RoleKey): Promise<void> {
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(userRoles)
      .values({ userId, roleKey: role, grantedBy: by.kind === 'user' ? by.userId : null })
      .onConflictDoNothing()
      .returning({ userId: userRoles.userId });
    if (inserted.length > 0) {
      await recordAudit(tx, {
        actor: by,
        action: 'role.granted',
        entityType: 'user',
        entityId: userId,
        metadata: { role },
      });
    }
  });
}

export async function revokeRole(db: Db, by: Actor, userId: string, role: RoleKey): Promise<void> {
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleKey, role)))
      .returning({ userId: userRoles.userId });
    if (removed.length > 0) {
      await recordAudit(tx, {
        actor: by,
        action: 'role.revoked',
        entityType: 'user',
        entityId: userId,
        metadata: { role },
      });
    }
  });
}
