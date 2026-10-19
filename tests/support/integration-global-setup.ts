import { resetDayLedger } from './dates';
import { resetAndMigrateTestDb } from './reset-test-db';

export default async function setup() {
  resetDayLedger();
  await resetAndMigrateTestDb();
}
