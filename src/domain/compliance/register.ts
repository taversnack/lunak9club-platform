import type { IsoDate } from '../time';

/**
 * Licence dog register fields (Sch. 4 Part 4 para 25; D68–D72). Pure helpers shared by the
 * onboarding form, the server and the Owner dog page.
 */

export type ConsentKey =
  | 'feedingConsent'
  | 'feedingWithOthersConsent'
  | 'cratingConsent'
  | 'parasiteTreatmentConsent'
  | 'medicationConsent'
  | 'groupWalksConsent'
  | 'mixingUnderOneConsent';

export type ConsentDef = {
  key: ConsentKey;
  /** One-line yes/no question shown to the customer. */
  question: string;
  /** Short label for the Owner. */
  label: string;
};

export type ConsentGroup = { title: string; consents: readonly ConsentDef[] };

/** Grouped as on the onboarding form (D69). The under-1 question is only asked for puppies. */
export const CONSENT_GROUPS: readonly ConsentGroup[] = [
  {
    title: 'Food and treats',
    consents: [
      { key: 'feedingConsent', question: 'May we feed your dog while they’re with us?', label: 'Feeding' },
      {
        key: 'feedingWithOthersConsent',
        question: 'May we feed your dog with other dogs nearby?',
        label: 'Feeding with other dogs',
      },
    ],
  },
  {
    title: 'Care and handling',
    consents: [
      { key: 'cratingConsent', question: 'May we rest your dog in a crate for short spells?', label: 'Crating' },
      {
        key: 'parasiteTreatmentConsent',
        question: 'May we give flea or worming treatment if a vet advises it?',
        label: 'Parasite treatment',
      },
      {
        key: 'medicationConsent',
        question: 'May we give your dog medicine you supply, as directed?',
        label: 'Giving medication',
      },
    ],
  },
  {
    title: 'Socialising',
    consents: [
      { key: 'groupWalksConsent', question: 'May your dog join group walks?', label: 'Group walks' },
      {
        key: 'mixingUnderOneConsent',
        question: 'Your dog is under 1 year old. May they mix with older dogs?',
        label: 'Mixing while under 1',
      },
    ],
  },
];

export const CONSENTS: readonly ConsentDef[] = CONSENT_GROUPS.flatMap((g) => g.consents);
export const CONSENT_KEYS: readonly ConsentKey[] = CONSENTS.map((c) => c.key);

/** True while the dog is under 12 months old on `today`. Unknown date of birth → false (D69). */
export function isUnderOneYear(dateOfBirth: IsoDate | null | undefined, today: IsoDate): boolean {
  if (!dateOfBirth) return false;
  const oneYearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return dateOfBirth > oneYearAgo;
}

/** Which consents the form asks for this dog today. */
export function consentsAsked(dateOfBirth: IsoDate | null | undefined, today: IsoDate): ConsentKey[] {
  return CONSENT_KEYS.filter((k) => k !== 'mixingUnderOneConsent' || isUnderOneYear(dateOfBirth, today));
}

export type StoredConsent = { value: boolean | null; at: Date | null; by: string | null };

/**
 * Work out which consent columns to write. A consent's time and "answered by" only change when
 * the answer changes (D69), so re-sending the form with the same answers keeps the original record.
 */
export function consentUpdates(
  answers: Partial<Record<ConsentKey, boolean>>,
  stored: Partial<Record<ConsentKey, StoredConsent>>,
  userId: string,
  now: Date,
): Record<string, boolean | Date | string> {
  const out: Record<string, boolean | Date | string> = {};
  for (const key of CONSENT_KEYS) {
    const answer = answers[key];
    if (answer === undefined) continue; // not asked this time – leave as it is
    if (stored[key]?.value === answer) continue;
    out[key] = answer;
    out[`${key}At`] = now;
    out[`${key}By`] = userId;
  }
  return out;
}

export type RegisterFacts = {
  dateOfBirth: IsoDate | null;
  health: {
    lastWormedOn: IsoDate | null;
    lastFleaTreatmentOn: IsoDate | null;
    exerciseRestricted: boolean | null;
    insured: boolean | null;
  } | null;
  consents: Partial<Record<ConsentKey, boolean | null>> | null;
  hasAgreedVet: boolean;
};

export type RegisterGap =
  'lastWormedOn' | 'lastFleaTreatmentOn' | 'exerciseRestricted' | 'insured' | 'agreedVet' | ConsentKey;

/**
 * Register fields still missing for a dog. Shown to the Owner as "Missing" badges and to the
 * customer as a gentle prompt; never blocks booking or check-in (D72).
 */
export function registerGaps(f: RegisterFacts, today: IsoDate): RegisterGap[] {
  const gaps: RegisterGap[] = [];
  if (!f.health?.lastWormedOn) gaps.push('lastWormedOn');
  if (!f.health?.lastFleaTreatmentOn) gaps.push('lastFleaTreatmentOn');
  if (f.health?.exerciseRestricted == null) gaps.push('exerciseRestricted');
  if (f.health?.insured == null) gaps.push('insured');
  if (!f.hasAgreedVet) gaps.push('agreedVet');
  for (const k of consentsAsked(f.dateOfBirth, today)) if (f.consents?.[k] == null) gaps.push(k);
  return gaps;
}
