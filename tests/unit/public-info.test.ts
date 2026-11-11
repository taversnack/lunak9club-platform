import { describe, expect, it } from 'vitest';
import type { Db } from '@/infra/db/client';
import { authorize, type Actor } from '@/server/policy/authorize';
import { PERMISSIONS, PUBLIC_PERMISSIONS } from '@/server/policy/permissions';
import { DEFAULT_FREE_CANCELLATION_HOURS, publicCancellationHours } from '@/server/services/public-info';

const anon: Actor = { kind: 'anonymous' };
const customer: Actor = { kind: 'user', userId: 'c1', roles: ['customer'], emailVerified: true };
const unverified: Actor = { kind: 'user', userId: 'u1', roles: ['customer'], emailVerified: false };
const owner: Actor = { kind: 'user', userId: 'o1', roles: ['owner'], emailVerified: true };

/** A stand-in for the database that records what was selected and returns what we give it. */
function fakeDb(result: () => unknown[] | Promise<unknown[]>) {
  const seen: { columns?: string[] } = {};
  const db = {
    select: (cols: Record<string, unknown>) => {
      seen.columns = Object.keys(cols);
      return { from: () => ({ where: async () => result() }) };
    },
  } as unknown as Db;
  return { db, seen };
}

describe('public permission', () => {
  it('is the only thing open to a signed-out visitor, and no role needs to hold it', () => {
    expect(PUBLIC_PERMISSIONS).toEqual(['public.cancellation_hours.read']);
    for (const actor of [anon, customer, unverified, owner])
      expect(authorize(actor, 'public.cancellation_hours.read')).toEqual({ allowed: true });
    // Everything else stays closed to anonymous visitors.
    for (const p of PERMISSIONS) expect(authorize(anon, p).allowed).toBe(false);
    expect(PERMISSIONS as readonly string[]).not.toContain('public.cancellation_hours.read');
  });
  it('does not widen what a customer can do', () => {
    for (const p of ['settings.manage', 'bookings.manage', 'admin.access'] as const)
      expect(authorize(customer, p).allowed).toBe(false);
  });
});

describe('publicCancellationHours', () => {
  it('returns just the configured whole number of hours, selecting only that column', async () => {
    const { db, seen } = fakeDb(() => [{ hours: 72 }]);
    expect(await publicCancellationHours(db)).toBe(72);
    expect(seen.columns).toEqual(['hours']);
  });
  it('works for a signed-out visitor, a customer and the Owner', async () => {
    for (const actor of [anon, customer, owner])
      expect(await publicCancellationHours(fakeDb(() => [{ hours: 24 }]).db, actor)).toBe(24);
  });
  it('falls back to the D39 default when the row is missing, odd or unreadable', async () => {
    expect(await publicCancellationHours(fakeDb(() => []).db)).toBe(DEFAULT_FREE_CANCELLATION_HOURS);
    expect(await publicCancellationHours(fakeDb(() => [{ hours: -1 }]).db)).toBe(48);
    expect(await publicCancellationHours(fakeDb(() => [{ hours: 12.5 }]).db)).toBe(48);
    expect(await publicCancellationHours(fakeDb(() => [{ hours: null }]).db)).toBe(48);
    expect(
      await publicCancellationHours(
        fakeDb(() => {
          throw new Error('connection refused postgres://user:secret@db/x');
        }).db,
      ),
    ).toBe(48);
  });
  it('the default is 48 hours', () => {
    expect(DEFAULT_FREE_CANCELLATION_HOURS).toBe(48);
  });
});
