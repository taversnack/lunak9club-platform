import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { bookingSettings } from '@/infra/db/schema';
import { publicCancellationHours } from '@/server/services/public-info';

afterAll(closeDb);

// Reads only: other test files run against the same database and read this setting, so this one must
// never change it (the changed-value case is covered with a stand-in database in tests/unit/public-info.test.ts).
describe('publicCancellationHours (real database)', () => {
  it('returns the Owner’s current setting as a plain integer for a signed-out visitor', async () => {
    const db = getDb();
    const [row] = await db.select().from(bookingSettings).where(eq(bookingSettings.id, 1));
    const hours = await publicCancellationHours(db, { kind: 'anonymous' });
    expect(hours).toBe(row!.freeCancellationHours);
    expect(Number.isInteger(hours)).toBe(true);
  });
});
