import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import { policyAcknowledgements, policyVersions } from '@/infra/db/schema';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError } from '../errors';
import { idOrNotFound, parseInput, requiredText } from '../validation';
import { asUser } from './customers';
import { currentTerms } from './compliance-facts';

export { currentTerms };

export async function myTermsStatus(db: Db, actor: Actor) {
  const me = asUser(actor);
  assertAuthorized(me, 'policies.self.accept', { ownerUserId: me.userId });
  const terms = await currentTerms(db);
  if (!terms) return { terms: null, acceptedAt: null };
  const [ack] = await db
    .select()
    .from(policyAcknowledgements)
    .where(and(eq(policyAcknowledgements.userId, me.userId), eq(policyAcknowledgements.policyVersionId, terms.id)));
  return { terms, acceptedAt: ack?.acknowledgedAt ?? null };
}

/** Accept a specific version. Refuses if it isn't the current one (the page was out of date). */
export async function acceptTerms(db: Db, actor: Actor, rawVersionId: string) {
  const me = asUser(actor);
  assertAuthorized(me, 'policies.self.accept', { ownerUserId: me.userId });
  const versionId = idOrNotFound(rawVersionId, 'Terms');
  const terms = await currentTerms(db);
  if (!terms) throw new NotFoundError('Terms');
  if (terms.id !== versionId) throw new ConflictError('These terms have been updated. Please read the latest version.');
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(policyAcknowledgements)
      .values({ userId: me.userId, policyVersionId: terms.id })
      .onConflictDoNothing()
      .returning({ userId: policyAcknowledgements.userId });
    if (inserted.length) {
      await recordAudit(tx, {
        actor: me,
        action: 'terms.accepted',
        entityType: 'policy_version',
        entityId: terms.id,
        metadata: { version: terms.version },
      });
    }
  });
}

export const PublishTermsInput = z.object({
  title: requiredText('a title', 200),
  body: requiredText('the terms', 50_000),
});

/** Owner publishes a new version; every customer must accept it again. */
export async function publishTerms(db: Db, actor: Actor, input: unknown) {
  assertAuthorized(actor, 'policies.manage');
  const data = parseInput(PublishTermsInput, input);
  return db.transaction(async (tx) => {
    const [last] = await tx
      .select({ version: policyVersions.version })
      .from(policyVersions)
      .where(eq(policyVersions.policyKey, 'terms'))
      .orderBy(desc(policyVersions.version))
      .limit(1)
      .for('update');
    const version = (last?.version ?? 0) + 1;
    const [row] = await tx
      .insert(policyVersions)
      .values({ policyKey: 'terms', version, ...data, publishedBy: actor.kind === 'user' ? actor.userId : null })
      .returning({ id: policyVersions.id });
    await recordAudit(tx, {
      actor,
      action: 'terms.published',
      entityType: 'policy_version',
      entityId: row!.id,
      metadata: { version },
    });
    return version;
  });
}
