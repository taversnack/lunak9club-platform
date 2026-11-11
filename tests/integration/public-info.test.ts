import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/infra/db/client';
import { bookingSettings } from '@/infra/db/schema';
import { publicCancellationHours } from '@/server/services/public-info';

afterAll(closeDb);

describe('publicCancellationHours (real database)', () => {
  it('returns the Owner’s setting as a plain integer for a signed-out visitor, and follows changes', async () => {
    const db = getDb();
    const [before] = await db.select().from(bookingSettings).where(eq(bookingSettings.id, 1));
    try {
      expect(await publicCancellationHours(db)).toBe(before!.freeCancellationHours);
      await db.update(bookingSettings).set({ freeCancellationHours: 72 }).where(eq(bookingSettings.id, 1));
      const hours = await publicCancellationHours(db, { kind: 'anonymous' });
      expect(hours).toBe(72);
      expect(typeof hours).toBe('number');
    } finally {
      await db
        .update(bookingSettings)
        .set({ freeCancellationHours: before!.freeCancellationHours })
        .where(eq(bookingSettings.id, 1));
    }
  });
});
