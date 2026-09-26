import { resetAndMigrateTestDb } from './reset-test-db';

export default async function setup() {
  await resetAndMigrateTestDb();
}
