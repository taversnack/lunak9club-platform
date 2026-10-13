import { describe, expect, it } from 'vitest';
import { tickFailed } from '@/server/services/tick-result';

describe('jobs:tick exit code', () => {
  it('a tick counts as failed when a daily job or an every-tick step failed', () => {
    expect(tickFailed({ jobs: [{ status: 'ran' }, { status: 'skipped' }], failed: [] })).toBe(false);
    expect(tickFailed({ jobs: [{ status: 'failed' }], failed: [] })).toBe(true);
    expect(tickFailed({ jobs: [], failed: ['card-refunds'] })).toBe(true);
  });
});
