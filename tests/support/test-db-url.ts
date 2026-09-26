import { config } from 'dotenv';
config({ quiet: true });

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://lunak9:lunak9@localhost:5432/lunak9_test';
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/.test(dbName)) throw new Error(`TEST_DATABASE_URL must point at a *test* database, got "${dbName}"`);
  return url;
}
