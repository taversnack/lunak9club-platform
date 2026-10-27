/**
 * The auth rate limits key on the client's address, so the client must not be able to choose it.
 * Before this, better-auth trusted a single-value X-Forwarded-For as sent: a new made-up value got a
 * fresh bucket straight after a 429 (tester finding, PR #66 notes 5).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/infra/db/client';
import { setEmailProvider } from '@/infra/email/providers';
import { env } from '@/infra/env';
import { createAuth } from '@/infra/auth/auth';
import { MemoryEmailProvider } from '../support/memory-email';
import { randomInt } from 'node:crypto';
import { authRequest } from '../support/auth-http';

beforeAll(() => setEmailProvider(new MemoryEmailProvider()));
afterAll(closeDb);

const signIn = (opts: Parameters<typeof authRequest>[1] = {}) =>
  authRequest('/sign-in/email', { ...opts, body: { email: 'nobody@example.test', password: 'wrong-password-xx' } });
const magicLink = (opts: Parameters<typeof authRequest>[1] = {}) =>
  authRequest('/sign-in/magic-link', { ...opts, body: { email: `ml-${Math.random()}@example.test` } });
// freshIp() restarts in every test file, and buckets live in the database, so use our own range.
const freshIp = () => `100.${64 + randomInt(64)}.${randomInt(256)}.${randomInt(1, 255)}`;
let spoof = 0;
const spoofed = () => `203.0.113.${++spoof % 250}`;

async function statusesFor(send: () => Promise<{ res: Response }>, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await send()).res.status);
  return out;
}

describe('behind the trusted proxy (TRUSTED_PROXIES)', () => {
  it('keeps a password sign-in limited when the client changes its own X-Forwarded-For', async () => {
    const ip = freshIp();
    const statuses = await statusesFor(() => signIn({ ip, xff: spoofed() }), 7);
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // The tester's sequence: a fresh made-up value straight after the 429.
    expect((await signIn({ ip, xff: `${spoofed()}, ${spoofed()}` })).res.status).toBe(429);
    // Another real client still has its own allowance.
    expect((await signIn({ ip: freshIp(), xff: spoofed() })).res.status).not.toBe(429);
  });

  it('keeps the magic-link request limited the same way', async () => {
    const ip = freshIp();
    const statuses = await statusesFor(() => magicLink({ ip, xff: spoofed() }), 5);
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    expect((await magicLink({ ip: freshIp() })).res.status).toBe(200);
  });
});

describe('with no proxy configured (the default)', () => {
  // A single-value X-Forwarded-For is exactly what a client sends directly: it must be ignored.
  const auth = createAuth({ ...env(), TRUSTED_PROXIES: [], CLIENT_IP_HEADER: undefined });

  it('does not let a made-up X-Forwarded-For open a new bucket', async () => {
    const statuses = await statusesFor(() => magicLink({ auth, ip: spoofed() }), 5);
    expect(statuses).toContain(429);
    expect((await magicLink({ auth, ip: spoofed() })).res.status).toBe(429);
  });
});

describe('with a proxy-set header (CLIENT_IP_HEADER)', () => {
  const auth = createAuth({ ...env(), TRUSTED_PROXIES: [], CLIENT_IP_HEADER: 'x-test-client-ip' });

  it('keys on that header and ignores X-Forwarded-For', async () => {
    const real = freshIp();
    const statuses = await statusesFor(
      () => magicLink({ auth, ip: spoofed(), headers: { 'x-test-client-ip': real } }),
      5,
    );
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    expect((await magicLink({ auth, ip: spoofed(), headers: { 'x-test-client-ip': freshIp() } })).res.status).toBe(200);
  });
});
