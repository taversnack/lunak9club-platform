import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import { contacts, customers } from '@/infra/db/schema';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { NotFoundError, ValidationError } from '../errors';
import { checkbox, idOrNotFound, optionalText, parseInput, requiredText, ukPhone, ukPostcode } from '../validation';

type UserActor = Extract<Actor, { kind: 'user' }>;

export function asUser(actor: Actor): UserActor {
  if (actor.kind !== 'user') throw new NotFoundError();
  return actor;
}

/** The caller's customer profile, created on first use. Only ever looked up by the caller's own user id. */
export async function getMyCustomer(db: Db, actor: Actor) {
  const me = asUser(actor);
  assertAuthorized(me, 'customer.self.read', { ownerUserId: me.userId });
  const existing = await db.select().from(customers).where(eq(customers.userId, me.userId));
  if (existing[0]) return existing[0];
  await db.insert(customers).values({ userId: me.userId }).onConflictDoNothing();
  const [row] = await db.select().from(customers).where(eq(customers.userId, me.userId));
  return row!;
}

export const ProfileInput = z.object({
  phone: ukPhone,
  addressLine1: requiredText('the first line of your address'),
  addressLine2: optionalText(200),
  town: requiredText('your town or city', 100),
  postcode: ukPostcode,
});

export async function updateMyProfile(db: Db, actor: Actor, input: unknown) {
  const data = parseInput(ProfileInput, input);
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'customer.self.update', { ownerUserId: customer.userId });
  await db.transaction(async (tx) => {
    await tx.update(customers).set(data).where(eq(customers.id, customer.id));
    await recordAudit(tx, {
      actor: me,
      action: 'customer.profile_updated',
      entityType: 'customer',
      entityId: customer.id,
    });
  });
}

export function isProfileComplete(c: typeof customers.$inferSelect): boolean {
  return Boolean(c.phone && c.addressLine1 && c.town && c.postcode);
}

export const ContactInput = z
  .object({
    name: requiredText('their name', 120),
    relationship: optionalText(80),
    phone: ukPhone,
    isEmergencyContact: checkbox,
    isAuthorisedCollector: checkbox,
  })
  .refine((c) => c.isEmergencyContact || c.isAuthorisedCollector, {
    message: 'Choose at least one: emergency contact or allowed to collect',
    path: ['isEmergencyContact'],
  });

export async function listMyContacts(db: Db, actor: Actor) {
  const customer = await getMyCustomer(db, actor);
  return db.select().from(contacts).where(eq(contacts.customerId, customer.id)).orderBy(asc(contacts.createdAt));
}

export async function addMyContact(db: Db, actor: Actor, input: unknown) {
  const data = parseInput(ContactInput, input);
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'customer.self.update', { ownerUserId: customer.userId });
  const existing = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.customerId, customer.id));
  if (existing.length >= 10) throw new ValidationError('You can add up to 10 contacts.');
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(contacts)
      .values({ ...data, customerId: customer.id })
      .returning({ id: contacts.id });
    await recordAudit(tx, { actor: me, action: 'contact.added', entityType: 'contact', entityId: row!.id });
  });
}

export async function removeMyContact(db: Db, actor: Actor, rawContactId: string) {
  const contactId = idOrNotFound(rawContactId, 'Contact');
  const me = asUser(actor);
  const customer = await getMyCustomer(db, me);
  assertAuthorized(me, 'customer.self.update', { ownerUserId: customer.userId });
  await db.transaction(async (tx) => {
    const removed = await tx
      .delete(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.customerId, customer.id)))
      .returning({ id: contacts.id });
    if (!removed.length) throw new NotFoundError('Contact');
    await recordAudit(tx, { actor: me, action: 'contact.removed', entityType: 'contact', entityId: contactId });
  });
}
