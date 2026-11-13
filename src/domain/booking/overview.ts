/**
 * The account overview's "Needs you" pay items and "Your requests and bookings" timeline (D76, D78–D80).
 * Pure functions, so the page and the unit tests share one rule.
 */
import type { BookingStatus } from './rules';
import type { EndedReason } from './ended-reason';
import type { PaymentState } from './payment-state';

type IsoDate = string;

/** "Mon 3 Nov": short enough for a button, still unique per day. */
export function shortUkDate(date: IsoDate): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "Biscuit, Mon 3 Nov" / "Biscuit and Rex, Mon 3 Nov and Tue 4 Nov" / "Biscuit, 4 days from Mon 3 Nov". */
export function daysLabel(days: { dogName: string; serviceDate: IsoDate }[]): string {
  const dogs = [...new Set(days.map((d) => d.dogName))];
  const dates = [...new Set(days.map((d) => d.serviceDate))].sort();
  const who = dogs.length <= 2 ? dogs.join(' and ') : `${dogs.length} dogs`;
  if (dates.length === 0) return who;
  const when =
    dates.length <= 2 ? dates.map(shortUkDate).join(' and ') : `${dates.length} days from ${shortUkDate(dates[0]!)}`;
  return `${who}, ${when}`;
}

/** A hold whose pay-by time has passed counts as released, even before the scheduler tick runs (D78). */
export function holdLapsed(offerExpiresAt: Date | null, now: Date): boolean {
  return offerExpiresAt !== null && offerExpiresAt <= now;
}

export type TimelineRow = {
  id: string;
  serviceDate: IsoDate;
  dogName: string;
  status: BookingStatus;
  offerExpiresAt: Date | null;
  cancelledAt: Date | null;
  /** Derived by the service; the raw user id of whoever cancelled never reaches the customer. */
  endedReason: EndedReason | null;
  lateCancellation: boolean;
  updatedAt: Date;
  /** What kind of day it is, whether a cancellation now would be late (the existing 48-hour terms) and how it was paid; all supplied by myBookings. Without them the wording stays neutral. */
  kind?: 'standard' | 'membership' | 'trial';
  late?: boolean;
  paymentState?: PaymentState;
};

export type TimelineState = {
  tone: 'info' | 'success' | 'warning' | 'danger';
  text: string;
  /** Plain next step or reason. */
  next: string;
  /** Ended (declined, released, withdrawn or cancelled): shown for RECENT_DAYS only. */
  ended: boolean;
  /** When it ended, for the recent window and ordering. */
  endedAt?: Date;
};

/** Ended items stay on the overview this long (then they're on Your requests / All bookings only). */
export const RECENT_DAYS = 14;

const RELEASED = 'Not paid in time, so the place was released. You’re welcome to request another day.';

/**
 * What cancelling a confirmed day means, true for each case (D18, D39, D56, D58, D106): inside the notice period it is
 * charged; a member day sends a refund request for Luna’s K9 Club to approve; a day paid by card is refunded to the card;
 * anything we can't tell keeps to what is always true (free at least that many hours ahead, charged after).
 */
export function confirmedNext(b: Pick<TimelineRow, 'kind' | 'late' | 'paymentState'>, hours: number): string {
  if (b.late)
    return `You’re booked. It’s less than ${hours} hours until it starts, so cancelling now is still charged.`;
  if (b.kind === 'membership')
    return `You’re booked. Cancel at least ${hours} hours ahead and a refund request goes to Luna’s K9 Club, who approve member refunds.`;
  if (b.paymentState === 'paid')
    return `You’re booked. Cancel at least ${hours} hours ahead and the day is refunded to your card.`;
  return `You’re booked. Cancelling at least ${hours} hours ahead is free; later than that it is charged.`;
}

export function timelineState(
  b: TimelineRow,
  ctx: {
    now: Date;
    today: IsoDate;
    /** Unused: kept so callers need no change. */ myUserId?: string;
    freeCancelHours: number;
    formatHold: (d: Date) => string;
  },
): TimelineState | null {
  switch (b.status) {
    case 'requested':
      return {
        tone: 'warning',
        text: 'Requested',
        next: 'Luna’s K9 Club will reply soon. Nothing to pay yet, and the day isn’t secured until it’s approved and paid for.',
        ended: false,
      };
    case 'pending_payment':
      if (holdLapsed(b.offerExpiresAt, ctx.now))
        return { tone: 'info', text: 'Released', next: RELEASED, ended: true, endedAt: b.offerExpiresAt! };
      return {
        tone: 'warning',
        text: 'Approved – pay to secure',
        next: b.offerExpiresAt
          ? `Pay by ${ctx.formatHold(b.offerExpiresAt)} to secure the day, or it’s released.`
          : 'Pay to secure the day.',
        ended: false,
      };
    case 'confirmed':
      return {
        tone: 'success',
        text: 'Confirmed',
        next: confirmedNext(b, ctx.freeCancelHours),
        ended: false,
      };
    case 'waitlisted':
      return {
        tone: 'info',
        text: 'On the waitlist',
        next: 'A place isn’t guaranteed. If Luna’s K9 Club gives you one, we’ll email you.',
        ended: false,
      };
    case 'rejected':
      return {
        tone: 'danger',
        text: 'Declined',
        next: 'Nothing to pay. You’re welcome to request another day.',
        ended: true,
        endedAt: b.updatedAt,
      };
    case 'cancelled': {
      const endedAt = b.cancelledAt ?? b.updatedAt;
      // No one cancelled it: a payment hold ran out (D78), or a request reached the booking cut-off (D79).
      if (b.endedReason !== 'cancelled_by_customer' && b.endedReason !== 'cancelled_by_owner')
        return b.offerExpiresAt
          ? { tone: 'info', text: 'Released', next: RELEASED, ended: true, endedAt }
          : {
              tone: 'info',
              text: 'Closed',
              next: 'It wasn’t approved before bookings closed for that day, so there’s no charge.',
              ended: true,
              endedAt,
            };
      if (b.endedReason === 'cancelled_by_customer')
        return {
          tone: 'info',
          text: 'Cancelled',
          next: b.lateCancellation
            ? `You cancelled less than ${ctx.freeCancelHours} hours ahead, so the day is still charged.`
            : 'You withdrew or cancelled this, so there’s no charge.',
          ended: true,
          endedAt,
        };
      return { tone: 'info', text: 'Cancelled', next: 'Cancelled by Luna’s K9 Club.', ended: true, endedAt };
    }
    default:
      return null;
  }
}

/**
 * What the overview lists: everything ended in the last RECENT_DAYS (newest first, so a recent Declined is never
 * pushed off; at most 5), then what's still to come (soonest first) to fill `limit`, always at least 3.
 * The "Your requests" link has the full history.
 */
export function overviewTimeline<T extends TimelineRow>(
  rows: T[],
  ctx: Parameters<typeof timelineState>[1],
  limit = 8,
): (T & { state: TimelineState })[] {
  const since = new Date(ctx.now.getTime() - RECENT_DAYS * 86_400_000);
  const all = rows.flatMap((b) => {
    const state = timelineState(b, ctx);
    return state ? [{ ...b, state }] : [];
  });
  const ended = all
    .filter((b) => b.state.ended && b.state.endedAt! >= since)
    .sort((a, b) => b.state.endedAt!.getTime() - a.state.endedAt!.getTime());
  const live = all
    .filter((b) => !b.state.ended && b.serviceDate >= ctx.today)
    .sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  // At most 5 ended items, and always room for at least 3 upcoming ones, so neither crowds the other out.
  const shownEnded = ended.slice(0, 5);
  return [...shownEnded, ...live.slice(0, Math.max(3, limit - shownEnded.length))];
}
