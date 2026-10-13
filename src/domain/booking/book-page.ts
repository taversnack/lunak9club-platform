/**
 * What the Book page shows for the customer's dogs. Dogs that can only ask for a trial day (D85)
 * still get the booking form with the trial option, not "Nothing to book yet".
 */
export function bookPageState(dogs: readonly { canBook: boolean; canRequestTrial: boolean }[]) {
  if (dogs.length === 0) return 'no-dogs' as const;
  if (!dogs.some((d) => d.canBook || d.canRequestTrial)) return 'nothing-to-book' as const;
  return 'form' as const;
}
