import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../../src/infra/db/client';
import { accounts, users } from '../../src/infra/db/schema';
import { grantRole } from '../../src/server/roles';
import { recordAudit } from '../../src/server/audit';
import type { RoleKey } from '../../src/server/policy/permissions';

const SYSTEM = { kind: 'system', job: 'bootstrap' } as const;

/** Create a verified email/password user with a role. Idempotent on email. */
export async function ensureUser(db: Db, input: { email: string; name: string; password: string; role: RoleKey }) {
  const email = input.email.trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  let userId = existing[0]?.id;
  if (!userId) {
    userId = randomUUID();
    const hash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId!, email, name: input.name, emailVerified: true });
      await tx
        .insert(accounts)
        .values({ id: randomUUID(), accountId: userId!, providerId: 'credential', userId: userId!, password: hash });
      await recordAudit(tx, { actor: SYSTEM, action: 'user.created', entityType: 'user', entityId: userId! });
    });
  }
  await grantRole(db, SYSTEM, userId, input.role);
  return userId;
}
