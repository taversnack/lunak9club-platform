import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

export default function globalSetup() {
  const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://lunak9:lunak9@localhost:5432/lunak9_test';
  if (!/test/.test(new URL(TEST_DB).pathname)) throw new Error('E2E must run against a *test* database');
  rmSync('.tmp/e2e-mail', { recursive: true, force: true });
  rmSync('.tmp/e2e-uploads', { recursive: true, force: true });
  const env = { ...process.env, DATABASE_URL: TEST_DB, STORAGE_DRIVER: 'fs', STORAGE_DIR: '.tmp/e2e-uploads' };
  execSync('pnpm -s db:reset && pnpm -s db:migrate && pnpm -s db:seed', { stdio: 'inherit', env });
}
