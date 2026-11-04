import { afterEach, describe, expect, it } from 'vitest';
import { parseReply, scanWithClamd } from '@/infra/scan/clamd';
import { FAKE_VIRUS_MARKER, startFakeClamd } from '../support/fake-clamd';

let stop: (() => Promise<void>) | undefined;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

const bytes = (s: string) => new TextEncoder().encode(s);

describe('clamd INSTREAM client (fake scanner, no real malware)', () => {
  it('reports clean for an ordinary file and sends every byte', async () => {
    const fake = await startFakeClamd('normal');
    stop = fake.close;
    const big = new Uint8Array(300_000).fill(65); // several chunks
    expect(await scanWithClamd(big, { host: '127.0.0.1', port: fake.port })).toBe('clean');
    expect(fake.received).toEqual([300_000]);
  });
  it('reports infected when the scanner finds something, without exposing the name', async () => {
    const fake = await startFakeClamd('normal');
    stop = fake.close;
    const result = await scanWithClamd(bytes(`hello ${FAKE_VIRUS_MARKER}`), { host: '127.0.0.1', port: fake.port });
    expect(result).toBe('infected');
    expect(JSON.stringify(result)).not.toContain('Signature');
  });
  it('is unavailable when the scanner returns an error, hangs, drops or is not running', async () => {
    for (const mode of ['error', 'hang', 'drop'] as const) {
      const fake = await startFakeClamd(mode);
      const r = await scanWithClamd(bytes('x'.repeat(50)), { host: '127.0.0.1', port: fake.port, timeoutMs: 400 });
      await fake.close();
      expect(r, mode).toBe('unavailable');
    }
    // Nothing listening on this port.
    const closed = await startFakeClamd('normal');
    const port = closed.port;
    await closed.close();
    expect(await scanWithClamd(bytes('x'), { host: '127.0.0.1', port, timeoutMs: 400 })).toBe('unavailable');
  });
});

describe('parseReply', () => {
  it.each([
    ['stream: OK\0', 'clean'],
    ['stream: Eicar-Test-Signature FOUND\0', 'infected'],
    ['INSTREAM size limit exceeded. ERROR', 'unavailable'],
    ['', 'unavailable'],
    ['stream: OK but also something else', 'unavailable'],
  ])('%j is %s', (reply, expected) => {
    expect(parseReply(reply)).toBe(expected);
  });
});
