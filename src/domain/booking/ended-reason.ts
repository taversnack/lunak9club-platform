/**
 * Why a booking day ended without being attended. Derived from data we already keep (no stored reason):
 * a lapsed hold, a closed request, a release by the system, or someone cancelling or declining it.
 */

/** Written into a booking day's internal note when its payment time runs out (payments.ts). */
export const HOLD_LAPSED_NOTE = 'Not paid in time';

export type EndedReason =
  | 'payment_expired'
  | 'request_closed'
  | 'released_by_system'
  | 'cancelled_by_customer'
  | 'cancelled_by_owner'
  | 'declined';

export type EndedRow = {
  status: string;
  cancelledBy: string | null;
  internalNote: string | null;
};

/** null for a day that hasn't ended (or ended another way, e.g. attended). */
export function endedReason(row: EndedRow, customerUserId: string): EndedReason | null {
  if (row.status === 'rejected') return 'declined';
  if (row.status !== 'cancelled') return null;
  if (row.cancelledBy) return row.cancelledBy === customerUserId ? 'cancelled_by_customer' : 'cancelled_by_owner';
  const note = row.internalNote?.trim();
  if (!note) return 'request_closed';
  return note.startsWith(HOLD_LAPSED_NOTE) ? 'payment_expired' : 'released_by_system';
}

/**
 * Keeps the lapsed-hold marker when the Owner edits the internal note of such a day, so the reason
 * can't be lost by editing the note. Other rows keep exactly what was typed.
 */
export function noteKeepingLapseMarker(
  row: Pick<EndedRow, 'status' | 'cancelledBy' | 'internalNote'>,
  typed: string | null,
): string | null {
  const lapsed =
    row.status === 'cancelled' && !row.cancelledBy && !!row.internalNote?.trim().startsWith(HOLD_LAPSED_NOTE);
  if (!lapsed) return typed;
  const text = (typed ?? '').trim();
  if (text.startsWith(HOLD_LAPSED_NOTE)) return text;
  return text ? `${HOLD_LAPSED_NOTE}\n${text}` : HOLD_LAPSED_NOTE;
}
