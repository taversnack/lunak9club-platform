import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { ConflictError, ValidationError } from '@/server/errors';
import { finishSignup, ownerCreateCustomer } from '@/server/services/membership-workflow';
import { MemoryEmailProvider, linkFrom } from '../support/memory-email';
import { makeUser, type TestUser } from '../support/factories';

// Count password hashing (the slow step) without changing what it does.
const hashed = vi.hoisted(() => ({ calls: 0 }));
vi.mock('better-auth/crypto', async (orig) => {
  const real = await orig<typeof import('better-auth/crypto')>();
  return {
    ...real,
    hashPassword: (p: string) => {
      hashed.calls++;
      return real.hashPassword(p);
    },
  };
});

const db = () => getDb();
const mail = new MemoryEmailProvider();
const GOOD = 'a-long-password';
let owner: TestUser;
let seq = 0;

async function invite() {
  const email = `finish.${Date.now()}.${seq++}@example.test`;
  await ownerCreateCustomer(db(), owner, { name: 'Ivy Invitee', email, dogs: [{ dogName: 'Pip', weekdays: [] }] });
  return new URL(linkFrom(mail.lastTo(email))).searchParams.get('token')!;
}
const attempt = (token: string, address: string, now = new Date(), password = GOOD) =>
  finishSignup(db(), { token, password, confirm: password }, now, { clientAddress: address });
const message = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Error).message;

beforeAll(async () => {
  setEmailProvider(mail);
  owner = await makeUser(db(), 'owner', 'Olive Owner');
});
afterAll(async () => {
  setEmailProvider(undefined);
  await closeDb();
});

describe('finish-signup hardening (unauthenticated invite action)', () => {
  it('only a usable link earns the password hash; every failure gives the same message', async () => {
    const token = await invite();
    const before = hashed.calls;
    const unknown = await message(attempt('x'.repeat(43), '198.51.100.10'));
    expect(hashed.calls).toBe(before); // a bad token costs no hashing
    const expired = await message(attempt(token, '198.51.100.10', new Date(Date.now() + 8 * 86_400_000)));
    expect(hashed.calls).toBe(before);
    await attempt(token, '198.51.100.10'); // the real thing works, and hashes once
    expect(hashed.calls).toBe(before + 1);
    const used = await message(attempt(token, '198.51.100.10'));
    expect(hashed.calls).toBe(before + 1);
    expect(new Set([unknown, expired, used]).size).toBe(1); // nothing tells the cases apart
    expect(unknown).toMatch(/expired or has already been used/);
  });

  it('password problems are reported the same way whether or not the token is real', async () => {
    const token = await invite();
    const real = (await attempt(token, '198.51.100.11', new Date(), 'short').catch((e: unknown) => e)) as Error;
    const fake = (await attempt('y'.repeat(43), '198.51.100.11', new Date(), 'short').catch(
      (e: unknown) => e,
    )) as Error;
    expect(real).toBeInstanceOf(ValidationError);
    expect(fake).toBeInstanceOf(ValidationError);
    expect(real.message).toBe(fake.message);
  });

  it('limits attempts per address (10 in 5 minutes), with the same message, and other addresses are unaffected', async () => {
    const token = await invite();
    const busy = '198.51.100.12';
    for (let i = 0; i < 10; i++)
      await expect(attempt(`bad${i}`.padEnd(43, 'z'), busy)).rejects.toBeInstanceOf(ConflictError);
    const before = hashed.calls;
    const blocked = await message(attempt(token, busy)); // a real link, but this address is over its limit
    expect(blocked).toMatch(/expired or has already been used/);
    expect(hashed.calls).toBe(before);
    // The link itself was not used up by that: a different address can still finish.
    await attempt(token, '198.51.100.13');
    expect(hashed.calls).toBe(before + 1);
    // The window passes: the busy address is allowed again.
    const later = new Date(Date.now() + 6 * 60_000);
    await expect(attempt('q'.repeat(43), busy, later)).rejects.toBeInstanceOf(ConflictError);
  });
});
