import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { userRoles, users } from '@/infra/db/schema';
import { getEmailProvider } from '@/infra/email/providers';
import type { EmailMessage } from '@/infra/email/types';
import { env } from '@/infra/env';
import { logger } from '@/infra/logger';

/** Send an email without failing the user's action; failures are logged by template only. */
export async function sendSafely(message: EmailMessage): Promise<void> {
  try {
    await getEmailProvider().send(message);
  } catch (err) {
    logger.error({ template: message.template, err: err instanceof Error ? err.name : 'unknown' }, 'email send failed');
  }
}

export const appUrl = (path: string) => new URL(path, env().APP_URL).toString();

export const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? 'there';

export async function ownerEmails(db: Db): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(userRoles)
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(eq(userRoles.roleKey, 'owner'));
  return rows.map((r) => r.email);
}
