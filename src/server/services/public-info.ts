import 'server-only';
import { eq } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { bookingSettings } from '@/infra/db/schema';
import { logger } from '@/infra/logger';
import { assertAuthorized, type Actor } from '../policy/authorize';

/** D39: free cancellation is 48 hours or more before the session. Used if the setting can't be read. */
export const DEFAULT_FREE_CANCELLATION_HOURS = 48;

/**
 * The Owner's free-cancellation notice in whole hours, for public pages such as the Home page. Goes through
 * authorize() with an explicit public action, so it is open to a signed-out visitor but exposes only this
 * one number: it selects just that column and returns just that integer (nothing else from the settings).
 * If the row is missing, unreadable or holds something unexpected, it falls back to D39's 48.
 */
export async function publicCancellationHours(db: Db, actor: Actor = { kind: 'anonymous' }): Promise<number> {
  assertAuthorized(actor, 'public.cancellation_hours.read');
  try {
    const [row] = await db
      .select({ hours: bookingSettings.freeCancellationHours })
      .from(bookingSettings)
      .where(eq(bookingSettings.id, 1));
    const hours = row?.hours;
    return Number.isInteger(hours) && hours! >= 0 && hours! <= 336 ? hours! : DEFAULT_FREE_CANCELLATION_HOURS;
  } catch {
    logger.warn({}, 'free-cancellation hours could not be read; using the default');
    return DEFAULT_FREE_CANCELLATION_HOURS;
  }
}
