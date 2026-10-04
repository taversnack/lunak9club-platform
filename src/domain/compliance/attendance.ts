import { addDays, formatUkDate, type IsoDate } from '../time';
import type { ChecklistItem, Evaluation } from './evaluate';

/**
 * Attendance rules for vaccinations (D11, D40, D42, D73, D74). Pure: used at every booking path
 * (customer, Owner, membership book-ahead) and at check-in, so they all agree.
 *
 * Licence guidance 9.4 (dog day care): core (distemper, hepatitis, parvovirus) and leptospirosis
 * must be current on a vet record that has been seen, so a problem with either is a hard block
 * that no reason can override – including trial days. Kennel cough is the business's own choice,
 * so the Owner may still override it with a reason. Primary courses must be finished at least
 * 2 weeks before a dog attends.
 */
export const LICENCE_VACCINATION_KEYS = ['vaccination_core', 'vaccination_leptospirosis'] as const;

/** Days after a first (primary) course finishes before the dog may attend (guidance 9.4). */
export const PRIMARY_COURSE_WAIT_DAYS = 14;

export function isLicenceVaccination(key: string): boolean {
  return (LICENCE_VACCINATION_KEYS as readonly string[]).includes(key);
}

export type AttendanceVaccination = Pick<
  ChecklistItem,
  'key' | 'label' | 'kind' | 'mandatory' | 'blocksBooking' | 'state' | 'expiresOn'
>;

export type AttendanceBlocks = {
  /** No override possible (licence): DHP/leptospirosis problems and the primary-course wait. */
  hard: string[];
  /** The Owner may override with a reason (kennel cough and any other business-only vaccination). */
  overridable: string[];
};

/** First date a dog may attend after finishing a primary course, or null when no date is recorded. */
export function primaryCourseClearOn(completedOn: IsoDate | null): IsoDate | null {
  return completedOn ? addDays(completedOn, PRIMARY_COURSE_WAIT_DAYS) : null;
}

/** Plain message for one vaccination that isn't valid on `date`, or null if it is. No dates or medical detail. */
export function vaccinationProblem(v: AttendanceVaccination, date: IsoDate): string | null {
  switch (v.state) {
    case 'met':
    case 'expiring_soon':
      return v.expiresOn && v.expiresOn >= date ? null : `${v.label} runs out before this date.`;
    case 'expired':
      return `${v.label} has expired. An up-to-date vet record is needed.`;
    case 'pending_review':
      return `${v.label}: the record is waiting to be checked by Luna’s K9 Club.`;
    case 'rejected':
      return `${v.label}: the record wasn’t accepted. A new vet record is needed.`;
    case 'replacement_requested':
      return `${v.label}: a new copy of the vet record is needed.`;
    default:
      return `${v.label} is missing. An up-to-date vet record is needed.`;
  }
}

/**
 * What stops a dog attending on `date` because of vaccinations. Licence vaccinations are checked
 * whatever the requirement's mandatory/blocks-booking settings say; other vaccinations only when
 * they are mandatory and block booking.
 */
export function vaccinationBlocksForDate(
  items: readonly AttendanceVaccination[],
  date: IsoDate,
  primaryCourseCompletedOn: IsoDate | null,
): AttendanceBlocks {
  const out: AttendanceBlocks = { hard: [], overridable: [] };
  for (const v of items) {
    if (v.kind !== 'vaccination') continue;
    const licence = isLicenceVaccination(v.key);
    if (!licence && !(v.mandatory && v.blocksBooking)) continue;
    const problem = vaccinationProblem(v, date);
    if (problem) (licence ? out.hard : out.overridable).push(problem);
  }
  const clear = primaryCourseClearOn(primaryCourseCompletedOn);
  if (clear && date < clear) {
    out.hard.push(
      `A first course of vaccinations must be finished at least ${PRIMARY_COURSE_WAIT_DAYS} days before attending. The earliest date is ${formatUkDate(clear)}.`,
    );
  }
  return out;
}

/** Every block as one list (customers and membership book-ahead can't override anything). */
export const allBlocks = (b: AttendanceBlocks): string[] => [...b.hard, ...b.overridable];

/** Vaccination blocks for an evaluated dog on a date. */
export const blocksForEvaluation = (e: Pick<Evaluation, 'items' | 'primaryCourseCompletedOn'>, date: IsoDate) =>
  vaccinationBlocksForDate(e.items, date, e.primaryCourseCompletedOn);
