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
 * Why a dog can't be chosen on the Book page, one sentence per entry so each shows on its own line
 * (empty when the dog can be booked or asked for as a trial day). A dog that has had its one trial
 * day (D95) says so first, then what is still needed.
 */
export function dogCantBookReasons(dog: DogWithReasons): string[] {
  if (dog.canBook || dog.canRequestTrial) return [];
  const blocker = dog.blockers[0] ?? null;
  if (dog.trialUsed) return blocker ? [trialAlreadyUsed(dog.name), blocker] : [trialAlreadyUsed(dog.name)];
  return [blocker ?? 'Please contact us.'];
}

/** One line per dog for the "Nothing to book yet" notice, so each dog shows its own reason. */
export function nothingToBookReasons(dogs: readonly DogWithReasons[]) {
  return dogs.flatMap((d) => {
    const reasons = dogCantBookReasons(d);
    return reasons.length ? [{ name: d.name, reasons }] : [];
  });
}
