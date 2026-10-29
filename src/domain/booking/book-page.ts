import { trialAlreadyUsed } from './wording';

type BookPageDog = { canBook: boolean; canRequestTrial: boolean };

/**
 * What the Book page shows for the customer's dogs. Dogs that can only ask for a trial day (D85)
 * still get the booking form with the trial option, not "Nothing to book yet".
 */
export function bookPageState(dogs: readonly BookPageDog[]) {
  if (dogs.length === 0) return 'no-dogs' as const;
  if (!dogs.some((d) => d.canBook || d.canRequestTrial)) return 'nothing-to-book' as const;
  return 'form' as const;
}

type DogWithReasons = BookPageDog & { name: string; blockers: readonly string[]; trialUsed?: boolean };

/**
 * Why this dog can't be booked or asked for as a trial day, in the app's existing wording: the
 * compliance blocker (not approved yet, bookings paused, a vaccination has expired…) and, for a dog
 * that has already had its one trial day, the D95 message first. Null when the dog can be chosen.
 */
export function dogCantBookReason(dog: DogWithReasons): string | null {
  if (dog.canBook || dog.canRequestTrial) return null;
  const blocker = dog.blockers[0] ?? null;
  if (dog.trialUsed) return blocker ? `${trialAlreadyUsed(dog.name)} ${blocker}` : trialAlreadyUsed(dog.name);
  return blocker ?? 'Please contact us.';
}

/** One line per dog for the "Nothing to book yet" notice, so each dog shows its own reason. */
export function nothingToBookReasons(dogs: readonly DogWithReasons[]) {
  return dogs.flatMap((d) => {
    const reason = dogCantBookReason(d);
    return reason ? [{ name: d.name, reason }] : [];
  });
}
