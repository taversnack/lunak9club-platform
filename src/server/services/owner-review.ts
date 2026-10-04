import 'server-only';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import {
  assessments,
  complianceRequirements,
  complianceSubmissions,
  contacts,
  customers,
  documents,
  dogBehaviourProfiles,
  dogHealthProfiles,
  dogPermissions,
  dogs,
  users,
  vets,
} from '@/infra/db/schema';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { idOrNotFound, isoDate, optionalText, parseInput } from '../validation';
import { evaluateDogs } from './compliance-facts';
import { appUrl, firstNameOf, sendSafely } from '../notify';
import { dogApprovedMessage, recordNeedsAttentionMessage } from '@/infra/email/templates';
import { isIsoDate, londonDate } from '@/domain/time';
import { CONSENT_KEYS, registerGaps } from '@/domain/compliance/register';
import { isLicenceVaccination } from '@/domain/compliance/attendance';

/** Owner: customers list with dog counts. Optional search by name, email or postcode. */
export async function listCustomers(db: Db, actor: Actor, q?: string) {
  assertAuthorized(actor, 'customers.read');
  const term = q?.trim().slice(0, 100);
  const where = term
    ? or(ilike(users.name, `%${term}%`), ilike(users.email, `%${term}%`), ilike(customers.postcode, `%${term}%`))
    : undefined;
  return db
    .select({
      id: customers.id,
      name: users.name,
      email: users.email,
      phone: customers.phone,
      postcode: customers.postcode,
      dogCount: sql<number>`(select count(*)::int from ${dogs} where ${dogs.customerId} = ${customers.id} and ${dogs.archivedAt} is null)`,
      createdAt: customers.createdAt,
    })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(where)
    .orderBy(asc(users.name))
    .limit(200);
}

export async function getCustomerForOwner(db: Db, actor: Actor, rawId: string) {
  assertAuthorized(actor, 'customers.read');
  const id = idOrNotFound(rawId, 'Customer');
  const [c] = await db
    .select({ customer: customers, name: users.name, email: users.email })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.id, id));
  if (!c) throw new NotFoundError('Customer');
  const [contactRows, dogRows] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.customerId, id)).orderBy(asc(contacts.createdAt)),
    db
      .select({ id: dogs.id, name: dogs.name, breed: dogs.breed, status: dogs.status })
      .from(dogs)
      .where(and(eq(dogs.customerId, id), isNull(dogs.archivedAt)))
      .orderBy(asc(dogs.createdAt)),
  ]);
  const evals = await evaluateDogs(
    db,
    dogRows.map((d) => d.id),
  );
  return { ...c, contacts: contactRows, dogs: dogRows.map((d) => ({ ...d, evaluation: evals.get(d.id)! })) };
}

/** Owner: what needs attention — records waiting for review and dogs ready for approval. */
export async function reviewQueue(db: Db, actor: Actor) {
  assertAuthorized(actor, 'compliance.review');
  const pending = await db
    .select({
      submissionId: complianceSubmissions.id,
      requirementLabel: complianceRequirements.label,
      expiresOn: complianceSubmissions.expiresOn,
      submittedAt: complianceSubmissions.submittedAt,
      dogId: dogs.id,
      dogName: dogs.name,
      customerName: users.name,
    })
    .from(complianceSubmissions)
    .innerJoin(complianceRequirements, eq(complianceRequirements.key, complianceSubmissions.requirementKey))
    .innerJoin(dogs, eq(dogs.id, complianceSubmissions.dogId))
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(complianceSubmissions.status, 'pending_review'))
    .orderBy(asc(complianceSubmissions.submittedAt));

  const notApproved = await db
    .select({ id: dogs.id, name: dogs.name, customerName: users.name })
    .from(dogs)
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(and(isNull(dogs.archivedAt), eq(dogs.status, 'not_started')));
  const evals = await evaluateDogs(
    db,
    notApproved.map((d) => d.id),
  );
  const ready = notApproved.filter((d) => evals.get(d.id)?.allMandatoryMet);
  const awaitingAssessment = notApproved.filter((d) => {
    const e = evals.get(d.id);
    return e && !e.allMandatoryMet && e.items.some((i) => i.kind === 'assessment' && i.state === 'waiting_for_us');
  });
  return { pending, ready, awaitingAssessment };
}

/** Owner: the full dog record, including sensitive health and behaviour information and internal notes. */
export async function getDogForOwner(db: Db, actor: Actor, rawDogId: string) {
  assertAuthorized(actor, 'dogs.read_sensitive');
  const dogId = idOrNotFound(rawDogId, 'Dog');
  const [row] = await db
    .select({
      dog: dogs,
      customerId: customers.id,
      customerName: users.name,
      customerEmail: users.email,
      customerPhone: customers.phone,
    })
    .from(dogs)
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(dogs.id, dogId));
  if (!row) throw new NotFoundError('Dog');
  const [health, behaviour, perms, vet, subs, asmts, contactRows, evals] = await Promise.all([
    db.select().from(dogHealthProfiles).where(eq(dogHealthProfiles.dogId, dogId)),
    db.select().from(dogBehaviourProfiles).where(eq(dogBehaviourProfiles.dogId, dogId)),
    db.select().from(dogPermissions).where(eq(dogPermissions.dogId, dogId)),
    row.dog.vetId ? db.select().from(vets).where(eq(vets.id, row.dog.vetId)) : Promise.resolve([]),
    db
      .select({
        id: complianceSubmissions.id,
        requirementKey: complianceSubmissions.requirementKey,
        requirementLabel: complianceRequirements.label,
        status: complianceSubmissions.status,
        expiresOn: complianceSubmissions.expiresOn,
        administeredOn: complianceSubmissions.administeredOn,
        primaryCourseCompletedOn: complianceSubmissions.primaryCourseCompletedOn,
        reviewReason: complianceSubmissions.reviewReason,
        submittedAt: complianceSubmissions.submittedAt,
        reviewedAt: complianceSubmissions.reviewedAt,
        version: complianceSubmissions.version,
        documentId: documents.id,
        documentName: documents.displayName,
        contentType: documents.contentType,
      })
      .from(complianceSubmissions)
      .innerJoin(documents, eq(documents.id, complianceSubmissions.documentId))
      .innerJoin(complianceRequirements, eq(complianceRequirements.key, complianceSubmissions.requirementKey))
      .where(eq(complianceSubmissions.dogId, dogId))
      .orderBy(desc(complianceSubmissions.submittedAt)),
    db.select().from(assessments).where(eq(assessments.dogId, dogId)).orderBy(desc(assessments.recordedAt)),
    db.select().from(contacts).where(eq(contacts.customerId, row.customerId)),
    evaluateDogs(db, [dogId]),
  ]);
  const p = perms[0] ?? null;
  // Who answered each consent (D69): names for the Owner page; ids never leave the server.
  const byIds = p ? [...new Set(CONSENT_KEYS.map((k) => p[`${k}By`]).filter((x): x is string => Boolean(x)))] : [];
  const [agreed, answeredBy] = await Promise.all([
    row.dog.agreedVetId && row.dog.agreedVetId !== row.dog.vetId
      ? db.select().from(vets).where(eq(vets.id, row.dog.agreedVetId))
      : Promise.resolve([]),
    byIds.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, byIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const names = new Map(answeredBy.map((u) => [u.id, u.name]));
  const consentAnswers = CONSENT_KEYS.map((k) => {
    const by = p?.[`${k}By`] ?? null;
    return {
      key: k,
      value: p?.[k] ?? null,
      at: p?.[`${k}At`] ?? null,
      byName: by
        ? by === (actor.kind === 'user' ? actor.userId : '')
          ? 'you'
          : (names.get(by) ?? 'a former user')
        : null,
    };
  });
  const h = health[0] ?? null;
  const gaps = registerGaps(
    {
      dateOfBirth: row.dog.dateOfBirth,
      health: h,
      consents: p,
      hasAgreedVet: Boolean(row.dog.agreedVetId),
    },
    londonDate(new Date()),
  );
  await recordAudit(db, { actor, action: 'dog.sensitive_viewed', entityType: 'dog', entityId: dogId });
  return {
    ...row,
    agreedVet: agreed[0] ?? null,
    consentAnswers,
    registerGaps: gaps,
    health: health[0] ?? null,
    behaviour: behaviour[0] ?? null,
    permissions: perms[0] ?? null,
    vet: vet[0] ?? null,
    submissions: subs,
    assessments: asmts,
    contacts: contactRows,
    evaluation: evals.get(dogId)!,
  };
}

async function customerOfDog(db: Db, dogId: string) {
  const [r] = await db
    .select({ dogName: dogs.name, email: users.email, name: users.name })
    .from(dogs)
    .innerJoin(customers, eq(customers.id, dogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(dogs.id, dogId));
  return r;
}

export const ReviewInput = z
  .object({
    decision: z.enum(['approve', 'reject', 'request_replacement'], { message: 'Choose a decision' }),
    reason: optionalText(500),
    expiresOn: isoDate('the expiry date'),
    /** Date given (D68). Blank keeps what the customer entered; the Owner corrects it here only (D72). */
    administeredOn: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || isIsoDate(v), 'Enter the date given as a real date'),
    /** D74: Owner may correct the first-course date. Left out → unchanged; empty → cleared. */
    primaryCourseCompletedOn: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || isIsoDate(v), 'Enter a valid date, or leave it empty'),
    version: z.coerce.number().int().positive(),
  })
  .refine((d) => d.decision === 'approve' || Boolean(d.reason), {
    message: 'Tell the customer what needs to change',
    path: ['reason'],
  });

/** Owner decision on one submission. Approving replaces any earlier approved record for the same vaccination. */
export async function reviewSubmission(db: Db, actor: Actor, rawId: string, input: unknown) {
  assertAuthorized(actor, 'compliance.review');
  const id = idOrNotFound(rawId, 'Submission');
  const d = parseInput(ReviewInput, input);
  const reviewer = actor.kind === 'user' ? actor.userId : null;
  const dogId = await db.transaction(async (tx) => {
    const [sub] = await tx.select().from(complianceSubmissions).where(eq(complianceSubmissions.id, id)).for('update');
    if (!sub) throw new NotFoundError('Submission');
    if (sub.status !== 'pending_review') throw new ConflictError('This record has already been reviewed.');
    if (sub.version !== d.version)
      throw new ConflictError('This record changed while you were looking at it. Please reload.');
    if (d.decision === 'approve' && d.expiresOn < londonDate(new Date())) {
      throw new ValidationError('Please check the highlighted fields.', {
        expiresOn: 'This date has passed – the vaccination has expired',
      });
    }
    const administeredOn = d.administeredOn ?? sub.administeredOn;
    if (administeredOn && (administeredOn > d.expiresOn || administeredOn > londonDate(new Date()))) {
      throw new ValidationError('Please check the highlighted fields.', {
        administeredOn:
          administeredOn > d.expiresOn
            ? 'The date given must be before the valid-until date'
            : 'This date is in the future',
      });
    }
    if (d.primaryCourseCompletedOn && d.primaryCourseCompletedOn > londonDate(new Date())) {
      throw new ValidationError('Please check the highlighted fields.', {
        primaryCourseCompletedOn: 'This date is in the future',
      });
    }
    if (d.decision === 'approve') {
      await tx
        .update(complianceSubmissions)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(complianceSubmissions.dogId, sub.dogId),
            eq(complianceSubmissions.requirementKey, sub.requirementKey),
            eq(complianceSubmissions.status, 'approved'),
          ),
        );
    }
    await tx
      .update(complianceSubmissions)
      .set({
        status: d.decision === 'approve' ? 'approved' : d.decision === 'reject' ? 'rejected' : 'replacement_requested',
        expiresOn: d.expiresOn,
        administeredOn,
        ...(d.primaryCourseCompletedOn === undefined
          ? {}
          : { primaryCourseCompletedOn: d.primaryCourseCompletedOn || null }),
        reviewReason: d.decision === 'approve' ? null : d.reason,
        reviewedBy: reviewer,
        reviewedAt: new Date(),
        version: sub.version + 1,
      })
      .where(eq(complianceSubmissions.id, id));
    await recordAudit(tx, {
      actor,
      action: `submission.${d.decision === 'approve' ? 'approved' : d.decision === 'reject' ? 'rejected' : 'replacement_requested'}`,
      entityType: 'compliance_submission',
      entityId: id,
      metadata: {
        dogId: sub.dogId,
        requirement: sub.requirementKey,
        expiryChanged: d.expiresOn !== sub.expiresOn,
        dateGivenChanged: administeredOn !== sub.administeredOn,
      },
    });
    return sub.dogId;
  });
  if (d.decision !== 'approve') {
    const c = await customerOfDog(db, dogId);
    if (c)
      await sendSafely(
        recordNeedsAttentionMessage(c.email, firstNameOf(c.name), c.dogName, appUrl(`/account/dogs/${dogId}`)),
      );
  }
}

export const AssessmentInput = z.object({
  kind: z.enum(['meet_and_greet', 'trial_day'], { message: 'Choose meet and greet or trial day' }),
  outcome: z.enum(['passed', 'not_passed', 'rescheduled'], { message: 'Choose an outcome' }),
  assessedOn: isoDate('the date'),
  internalNotes: optionalText(4000),
});

export async function recordAssessment(db: Db, actor: Actor, rawDogId: string, input: unknown) {
  assertAuthorized(actor, 'assessments.manage');
  const dogId = idOrNotFound(rawDogId, 'Dog');
  const d = parseInput(AssessmentInput, input);
  if (d.assessedOn > londonDate(new Date())) {
    throw new ValidationError('Please check the highlighted fields.', {
      assessedOn: 'Record assessments on or after the day they happen',
    });
  }
  if (actor.kind !== 'user') throw new NotFoundError();
  await db.transaction(async (tx) => {
    const [dog] = await tx.select({ id: dogs.id }).from(dogs).where(eq(dogs.id, dogId));
    if (!dog) throw new NotFoundError('Dog');
    const [row] = await tx
      .insert(assessments)
      .values({ ...d, dogId, recordedBy: actor.userId })
      .returning({ id: assessments.id });
    await recordAudit(tx, {
      actor,
      action: 'assessment.recorded',
      entityType: 'dog',
      entityId: dogId,
      metadata: { kind: d.kind, outcome: d.outcome, assessmentId: row!.id },
    });
  });
}

export const DogStatusInput = z
  .object({
    status: z.enum(['approved', 'suspended', 'rejected', 'not_started'], { message: 'Choose a status' }),
    reason: optionalText(500),
    version: z.coerce.number().int().positive(),
  })
  .refine((d) => d.status === 'approved' || d.status === 'not_started' || Boolean(d.reason), {
    message: 'Give a reason the customer will see',
    path: ['reason'],
  });

/** Owner approves, suspends, rejects or reopens a dog. Approval requires every mandatory requirement to be met. */
export async function setDogStatus(db: Db, actor: Actor, rawDogId: string, input: unknown) {
  assertAuthorized(actor, 'dogs.approve');
  const dogId = idOrNotFound(rawDogId, 'Dog');
  const d = parseInput(DogStatusInput, input);
  if (d.status === 'approved') {
    const e = (await evaluateDogs(db, [dogId])).get(dogId);
    if (!e) throw new NotFoundError('Dog');
    if (!e.allMandatoryMet) throw new ConflictError('All required items must be done before approving this dog.');
  }
  await db.transaction(async (tx) => {
    const [dog] = await tx.select().from(dogs).where(eq(dogs.id, dogId)).for('update');
    if (!dog) throw new NotFoundError('Dog');
    if (dog.version !== d.version)
      throw new ConflictError('This dog changed while you were looking at it. Please reload.');
    await tx
      .update(dogs)
      .set({
        status: d.status,
        statusReason: d.status === 'approved' || d.status === 'not_started' ? null : d.reason,
        approvedAt: d.status === 'approved' ? new Date() : dog.approvedAt,
        approvedBy: d.status === 'approved' && actor.kind === 'user' ? actor.userId : dog.approvedBy,
        version: dog.version + 1,
      })
      .where(eq(dogs.id, dogId));
    await recordAudit(tx, {
      actor,
      action: `dog.status_${d.status}`,
      entityType: 'dog',
      entityId: dogId,
      metadata: { from: dog.status },
    });
  });
  if (d.status === 'approved') {
    const c = await customerOfDog(db, dogId);
    if (c)
      await sendSafely(dogApprovedMessage(c.email, firstNameOf(c.name), c.dogName, appUrl(`/account/dogs/${dogId}`)));
  }
}

export async function listRequirements(db: Db, actor: Actor) {
  assertAuthorized(actor, 'requirements.manage');
  return db.select().from(complianceRequirements).orderBy(asc(complianceRequirements.sortOrder));
}

export const RequirementInput = z.object({
  mandatory: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
  blocksBooking: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
  active: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
  reminderDays: z
    .string()
    .trim()
    .transform((s) => (s ? s.split(/[\s,]+/).map(Number) : []))
    .refine(
      (xs) => xs.every((n) => Number.isInteger(n) && n > 0 && n <= 365) && xs.length <= 5,
      'Use up to 5 whole numbers of days, like 60, 30, 14, 7',
    )
    .transform((xs) => [...new Set(xs)].sort((a, b) => b - a)),
});

export async function updateRequirement(db: Db, actor: Actor, key: string, input: unknown) {
  assertAuthorized(actor, 'requirements.manage');
  const d = parseInput(RequirementInput, input);
  // Licence guidance 9.4: core and leptospirosis must always be required (D73).
  if (isLicenceVaccination(key) && !(d.mandatory && d.blocksBooking && d.active))
    throw new ValidationError('The licence requires this vaccination, so it must stay mandatory and block booking.', {
      mandatory: 'Licence requirement – can’t be turned off',
    });
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(complianceRequirements)
      .set(d)
      .where(eq(complianceRequirements.key, key))
      .returning({ key: complianceRequirements.key });
    if (!updated.length) throw new NotFoundError('Requirement');
    await recordAudit(tx, {
      actor,
      action: 'requirement.updated',
      entityType: 'compliance_requirement',
      entityId: key,
      metadata: {
        mandatory: d.mandatory,
        blocksBooking: d.blocksBooking,
        active: d.active,
        reminderDays: d.reminderDays.join(','),
      },
    });
  });
}
