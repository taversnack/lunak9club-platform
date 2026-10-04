import { addDays, daysBetween, type IsoDate } from '../time';

/**
 * Which vaccination reminder is due today (D11, D66): the nearest threshold already reached
 * (30, 14 or 7 days before expiry), or 'expired' once the date has passed. Taking the nearest
 * means a dog first seen with 10 days left gets the 14-day reminder, not 30 and 14 together.
 */
export function vaccinationReminderDue(
  expiresOn: IsoDate,
  today: IsoDate,
  thresholds: readonly number[],
): number | 'expired' | null {
  if (today > expiresOn) return 'expired';
  const left = daysBetween(today, expiresOn);
  const reached = thresholds.filter((d) => d >= left);
  return reached.length ? Math.min(...reached) : null;
}

/** Concerns the licence says the dog's owner must be told about (statutory guidance, dog day care). */
export const MUST_TELL_OWNER = [
  'drinking_more',
  'drinking_less',
  'stress',
  'fear',
  'aggression',
  'anxiety',
  'pain',
] as const;

export const CONCERN_LABELS: Record<string, string> = {
  drinking_more: 'Drinking more than usual',
  drinking_less: 'Drinking less than usual',
  stress: 'Signs of stress',
  fear: 'Signs of fear',
  aggression: 'Signs of aggression',
  anxiety: 'Signs of anxiety',
  pain: 'Signs of pain or suffering',
};

/** The concerns recorded on a check, including drinking changes, and whether it must be shared (D63). */
export function welfareConcerns(drinking: 'normal' | 'more' | 'less', concerns: readonly string[]) {
  const all = new Set(concerns.filter((c) => (MUST_TELL_OWNER as readonly string[]).includes(c)));
  if (drinking === 'more') all.add('drinking_more');
  if (drinking === 'less') all.add('drinking_less');
  const list = [...all].sort();
  return { concerns: list, mustShare: list.length > 0 };
}

export function addYears(date: IsoDate, years: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = `${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // 29 Feb → 28 Feb in a non-leap year.
  return target.endsWith('-02-29') && new Date(`${y + years}-02-29T00:00:00Z`).getUTCMonth() !== 1
    ? `${y + years}-02-28`
    : target;
}

/** Retention schedule (D64). */
export const RETENTION = {
  /** Licence records: register, health, attendance, incidents, welfare checks. */
  licenceYears: 3,
  /** Invoices, payments and the audit log (HMRC / Companies Act). */
  financialYears: 6,
  /** Uploaded documents: after the record they prove has expired. */
  documentYearsAfterExpiry: 3,
  /** Technical data: expired sessions, tokens, webhook events. */
  technicalDays: 90,
} as const;

/** When a customer's personal details may be removed: 3 years after their last visit (or sign-up). */
export function personalDataRetainUntil(lastVisit: IsoDate | null, joined: IsoDate): IsoDate {
  return addYears(lastVisit ?? joined, RETENTION.licenceYears);
}

export function retentionCutoffs(today: IsoDate) {
  return {
    licence: addYears(today, -RETENTION.licenceYears),
    financial: addYears(today, -RETENTION.financialYears),
    documents: addYears(today, -RETENTION.documentYearsAfterExpiry),
    technical: addDays(today, -RETENTION.technicalDays),
  };
}
