import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import {
  assessments,
  complianceRequirements,
  complianceSubmissions,
  contacts,
  customers,
  dogs,
  policyAcknowledgements,
  policyVersions,
} from '@/infra/db/schema';
import { evaluateDogCompliance, type Evaluation, type RequirementDef } from '@/domain/compliance/evaluate';
import { londonDate } from '@/domain/time';

export async function activeRequirements(db: Pick<Db, 'select'>): Promise<RequirementDef[]> {
  const rows = await db
    .select()
    .from(complianceRequirements)
    .where(eq(complianceRequirements.active, true))
    .orderBy(asc(complianceRequirements.sortOrder));
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    kind: r.kind,
    mandatory: r.mandatory,
    blocksBooking: r.blocksBooking,
    reminderDays: r.reminderDays,
  }));
}

export async function currentTerms(db: Pick<Db, 'select'>) {
  const [row] = await db
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.policyKey, 'terms'))
    .orderBy(desc(policyVersions.version))
    .limit(1);
  return row ?? null;
}

/**
 * Load the facts for a set of dogs and evaluate each one. Callers must already have
 * authorised access to these dogs; this function does no permission checks itself.
 */
export async function evaluateDogs(db: Db, dogIds: string[], now = new Date()): Promise<Map<string, Evaluation>> {
  const out = new Map<string, Evaluation>();
  if (!dogIds.length) return out;
  const [reqs, terms, dogRows, subs, asmts] = await Promise.all([
    activeRequirements(db),
    currentTerms(db),
    db
      .select({
        id: dogs.id,
        status: dogs.status,
        vetId: dogs.vetId,
        onboardingSubmittedAt: dogs.onboardingSubmittedAt,
        customerId: dogs.customerId,
        userId: customers.userId,
      })
      .from(dogs)
      .innerJoin(customers, eq(customers.id, dogs.customerId))
      .where(inArray(dogs.id, dogIds)),
    db.select().from(complianceSubmissions).where(inArray(complianceSubmissions.dogId, dogIds)),
    db.select().from(assessments).where(inArray(assessments.dogId, dogIds)),
  ]);
  const customerIds = [...new Set(dogRows.map((d) => d.customerId))];
  const userIds = [...new Set(dogRows.map((d) => d.userId))];
  const [emergency, acks] = await Promise.all([
    db
      .select({ customerId: contacts.customerId })
      .from(contacts)
      .where(and(inArray(contacts.customerId, customerIds), eq(contacts.isEmergencyContact, true))),
    terms
      ? db
          .select({ userId: policyAcknowledgements.userId })
          .from(policyAcknowledgements)
          .where(
            and(inArray(policyAcknowledgements.userId, userIds), eq(policyAcknowledgements.policyVersionId, terms.id)),
          )
      : Promise.resolve([] as { userId: string }[]),
  ]);
  const hasEmergency = new Set(emergency.map((e) => e.customerId));
  const accepted = new Set(acks.map((a) => a.userId));
  const today = londonDate(now);

  for (const d of dogRows) {
    out.set(
      d.id,
      evaluateDogCompliance({
        today,
        requirements: reqs,
        dog: { status: d.status, hasVet: Boolean(d.vetId), onboardingSubmitted: Boolean(d.onboardingSubmittedAt) },
        hasEmergencyContact: hasEmergency.has(d.customerId),
        acceptedCurrentTerms: terms ? accepted.has(d.userId) : true,
        submissions: subs
          .filter((s) => s.dogId === d.id)
          .map((s) => ({
            requirementKey: s.requirementKey,
            status: s.status,
            expiresOn: s.expiresOn,
            reviewReason: s.reviewReason,
            submittedAt: s.submittedAt,
            primaryCourseCompletedOn: s.primaryCourseCompletedOn,
          })),
        assessments: asmts
          .filter((a) => a.dogId === d.id)
          .map((a) => ({ kind: a.kind, outcome: a.outcome, recordedAt: a.recordedAt })),
      }),
    );
  }
  return out;
}
