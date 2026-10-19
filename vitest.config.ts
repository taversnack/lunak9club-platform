import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import OrderedSequencer from './tests/support/ordered-sequencer';

const alias = {
  '@': fileURLToPath(new URL('./src', import.meta.url)),
  // `server-only` throws outside React Server Components; tests run server code directly.
  'server-only': fileURLToPath(new URL('./tests/support/empty.ts', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    // Root-level: sequencing isn't a per-project option.
    sequence: { sequencer: OrderedSequencer },
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/support/integration-global-setup.ts'],
          setupFiles: ['tests/support/integration-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
