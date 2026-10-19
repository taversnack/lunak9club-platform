import { config } from 'dotenv';
config({ quiet: true });

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  // No fallback: a default shared name let parallel checkouts reset each other's database.
  if (!url) throw new Error('TEST_DATABASE_URL is not set (add it to .env or export it); see .env.example');
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/.test(dbName)) throw new Error(`TEST_DATABASE_URL must point at a *test* database, got "${dbName}"`);
  return url;
}
