import { randomUUID } from 'node:crypto';
import type { Db } from '../../src/infra/db/client';
import { userRoles, users } from '../../src/infra/db/schema';
import type { Actor } from '../../src/server/policy/authorize';

export type TestUser = Extract<Actor, { kind: 'user' }> & { email: string };

export async function makeUser(db: Db, role: 'owner' | 'customer', name = 'Test Person'): Promise<TestUser> {
  const id = randomUUID();
  const email = `${role}.${id.slice(0, 8)}@example.test`;
  await db.insert(users).values({ id, name, email, emailVerified: true });
  await db.insert(userRoles).values({ userId: id, roleKey: role });
  return { kind: 'user', userId: id, roles: [role], emailVerified: true, email };
}

export const PDF = new Uint8Array([...'%PDF-1.7\n'].map((c) => c.charCodeAt(0)).concat(Array(64).fill(32)));
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0)]);

export const validDog = {
  name: 'Biscuit',
  breed: 'Cockapoo',
  sex: 'female',
  dateOfBirth: '2022-04-01',
  weightKg: '11.5',
  microchipNumber: '826 000 000 000 001',
  neutered: 'yes',
};

export const validOnboarding = {
  fleaAndWorming: 'Monthly spot-on, last 1 September',
  temperament: 'Friendly and playful',
  biteHistory: 'no',
  transport: 'yes',
  photosAndSocialMedia: 'no',
  emergencyVetTreatment: 'yes',
  confirmAccurate: 'on',
};
