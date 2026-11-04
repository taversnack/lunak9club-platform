import { describe, expect, it } from 'vitest';
import { inSequence } from '@/infra/db/sequence';

describe('inSequence', () => {
  it('starts each step only after the previous one has finished, and keeps the order of results', async () => {
    const log: string[] = [];
    const step = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
      return name;
    };
    const [a, b, c] = await inSequence(step('a', 15), step('b', 1), async () => 3);
    expect([a, b, c]).toEqual(['a', 'b', 3]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});
