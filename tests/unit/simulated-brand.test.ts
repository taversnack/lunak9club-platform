import { describe, expect, it, vi } from 'vitest';
import { isSimulatedProvider, SimulatedPaymentProvider } from '@/infra/payments/simulated';

describe('simulated payment provider check (bundle-safe)', () => {
  it('recognises an instance made by another copy of the module', async () => {
    const mine = new SimulatedPaymentProvider('http://x');
    vi.resetModules();
    // A fresh module copy, as a separate Next bundle would load it.
    const other = (await import(
      /* @vite-ignore */ `${'@/infra/payments/simulated'}?copy`
    )) as typeof import('@/infra/payments/simulated');
    const theirs = new other.SimulatedPaymentProvider('http://x');
    expect(theirs instanceof SimulatedPaymentProvider).toBe(false);
    expect(isSimulatedProvider(theirs)).toBe(true);
    expect(other.isSimulatedProvider(mine)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isSimulatedProvider({ name: 'simulated', sessions: new Map() })).toBe(false);
    expect(isSimulatedProvider(null)).toBe(false);
  });
});
