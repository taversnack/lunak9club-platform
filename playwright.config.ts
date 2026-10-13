import { defineConfig, devices } from '@playwright/test';

import { testDatabaseUrl } from './tests/support/test-db-url'; // also loads .env

// Use a port of your own (E2E_PORT) when several checkouts share a machine: Playwright reuses any server
// already listening there. E2E_HOST defaults to 127.0.0.1 because `localhost` may not resolve to loopback.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const HOST = process.env.E2E_HOST ?? '127.0.0.1';
const BASE = process.env.E2E_BASE_URL ?? `http://${HOST}:${PORT}`;
const TEST_DB = testDatabaseUrl();
export const E2E_MAIL_DIR = '.tmp/e2e-mail';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Runs the production build. `pnpm build` must have run first (pnpm verify does this).
    command: `pnpm start -p ${PORT}`,
    url: `${BASE}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      APP_ENV: 'test',
      APP_URL: BASE,
      BETTER_AUTH_URL: BASE,
      DATABASE_URL: TEST_DB,
      EMAIL_TRANSPORT: 'file',
      MAIL_DIR: E2E_MAIL_DIR,
      AUTH_RATE_LIMIT: 'off',
      STORAGE_DRIVER: 'fs',
      STORAGE_DIR: '.tmp/e2e-uploads',
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-secret-e2e-secret-e2e-secret-0000',
      LOG_LEVEL: 'warn',
    },
  },
});
