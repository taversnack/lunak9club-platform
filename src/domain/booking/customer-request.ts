/**
 * What a customer's booking request may ask for (Stephen, 29 Oct 2026): full days only, the dog taxi is
 * included for everyone (no separate choice and no charge), and a day that is full goes on the waitlist.
 * The customer form no longer offers session, taxi or "if a day is full", and any such values sent anyway
 * are ignored here. The Owner's own booking form and memberships don't use this and are unchanged.
 */
export type CustomerBookingFields = {
  dogIds: string[];
  dates: string[];
  trial: boolean;
  customerNote?: string;
};

export function customerBookingInput(f: CustomerBookingFields) {
  return {
    dogIds: f.dogIds,
    dates: f.dates,
    session: 'full' as const,
    taxi: false,
    ifFull: 'waitlist' as const,
    trial: f.trial,
    ...(f.customerNote === undefined ? {} : { customerNote: f.customerNote }),
  };
}
