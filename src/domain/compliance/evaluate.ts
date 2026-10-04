import { daysBetween, type IsoDate } from '../time';
import { isLicenceVaccination } from './attendance';

/**
 * Pure onboarding/compliance evaluation for one dog (D10, D11, D31).
 * Inputs are plain facts loaded by the server layer; output drives both the
 * customer checklist and the Owner review screen, so both always agree.
 */
export type RequirementKind =
  'vaccination' | 'vet_details' | 'emergency_contact' | 'onboarding_form' | 'terms' | 'assessment';

export type RequirementDef = {
  key: string;
  label: string;
  kind: RequirementKind;
  mandatory: boolean;
  blocksBooking: boolean;
  reminderDays: readonly number[];
};

export type SubmissionFact = {
  requirementKey: string;
  status: 'pending_review' | 'approved' | 'rejected' | 'replacement_requested' | 'superseded';
  expiresOn: IsoDate;
  reviewReason: string | null;
  submittedAt: Date;
  /** Date the dog's first (primary) course finished, if the customer said this record is one (D74). */
  primaryCourseCompletedOn?: IsoDate | null;
};

export type AssessmentFact = {
  kind: 'meet_and_greet' | 'trial_day';
  outcome: 'passed' | 'not_passed' | 'rescheduled';
  recordedAt: Date;
};

export type DogFacts = {
  status: 'not_started' | 'pending_review' | 'approved' | 'suspended' | 'rejected';
  hasVet: boolean;
  onboardingSubmitted: boolean;
};

export type EvaluateInput = {
  today: IsoDate;
  requirements: readonly RequirementDef[];
  dog: DogFacts;
  hasEmergencyContact: boolean;
  acceptedCurrentTerms: boolean;
  submissions: readonly SubmissionFact[];
  assessments: readonly AssessmentFact[];
};

export type ItemState =
  | 'met'
  | 'expiring_soon'
  | 'expired'
  | 'pending_review'
  | 'rejected'
  | 'replacement_requested'
  | 'to_do'
  | 'waiting_for_us'
  | 'not_passed';

export type ChecklistItem = {
  key: string;
  label: string;
  kind: RequirementKind;
  mandatory: boolean;
  blocksBooking: boolean;
  state: ItemState;
  /** Customer-facing explanation of what's needed, if anything. */
  action: string | null;
  expiresOn: IsoDate | null;
  /** True when a newer submission is waiting for review alongside a current approval. */
  renewalPending: boolean;
};

export type OverallStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending_review'
  | 'ready_for_approval'
  | 'approved'
  | 'expiring_soon'
  | 'action_needed'
  | 'suspended'
  | 'rejected';

export type Evaluation = {
  items: ChecklistItem[];
  /** Every mandatory item is met or expiring soon (i.e. currently valid). */
  allMandatoryMet: boolean;
  /** The Owner has approved the dog AND nothing blocking is missing or expired. */
  canBook: boolean;
  /** Customer-facing reasons a booking would be blocked. */
  bookingBlockers: string[];
  /** The same, without vaccination items (those are judged per date by `domain/compliance/attendance`). */
  otherBlockers: string[];
  overall: OverallStatus;
  /** Latest primary-course completion date on an approved vaccination record, if any (D74). */
  primaryCourseCompletedOn: IsoDate | null;
};

const latest = <T extends { submittedAt?: Date; recordedAt?: Date }>(xs: T[]): T | undefined =>
  [...xs].sort((a, b) => (b.submittedAt ?? b.recordedAt)!.getTime() - (a.submittedAt ?? a.recordedAt)!.getTime())[0];

function vaccinationItem(
  req: RequirementDef,
  subs: SubmissionFact[],
  today: IsoDate,
): Pick<ChecklistItem, 'state' | 'action' | 'expiresOn' | 'renewalPending'> {
  const mine = subs.filter((s) => s.requirementKey === req.key);
  const approved = mine.find((s) => s.status === 'approved');
  const pending = mine.find((s) => s.status === 'pending_review');
  const lastClosed = latest(mine.filter((s) => s.status === 'rejected' || s.status === 'replacement_requested'));

  if (approved) {
    const daysLeft = daysBetween(today, approved.expiresOn);
    const warnAt = Math.max(0, ...req.reminderDays);
    if (daysLeft < 0) {
      return pending
        ? { state: 'pending_review', action: null, expiresOn: approved.expiresOn, renewalPending: true }
        : {
            state: 'expired',
            action: 'Upload an up-to-date vaccination record.',
            expiresOn: approved.expiresOn,
            renewalPending: false,
          };
    }
    if (daysLeft <= warnAt) {
      return {
        state: 'expiring_soon',
        action: pending ? null : 'Upload the new record once your dog has had the booster.',
        expiresOn: approved.expiresOn,
        renewalPending: Boolean(pending),
      };
    }
    return { state: 'met', action: null, expiresOn: approved.expiresOn, renewalPending: Boolean(pending) };
  }
  if (pending) return { state: 'pending_review', action: null, expiresOn: pending.expiresOn, renewalPending: false };
  if (lastClosed) {
    return {
      state: lastClosed.status === 'rejected' ? 'rejected' : 'replacement_requested',
      action: lastClosed.reviewReason ?? 'Please upload a new record.',
      expiresOn: null,
      renewalPending: false,
    };
  }
  return {
    state: 'to_do',
    action: 'Upload a photo or PDF of the vaccination record.',
    expiresOn: null,
    renewalPending: false,
  };
}

function assessmentItem(key: string, assessments: readonly AssessmentFact[]): Pick<ChecklistItem, 'state' | 'action'> {
  const kind = key === 'trial_day' ? 'trial_day' : 'meet_and_greet';
  const last = latest(assessments.filter((a) => a.kind === kind));
  if (!last || last.outcome === 'rescheduled') {
    return {
      state: 'waiting_for_us',
      action: kind === 'trial_day' ? 'We’ll arrange a trial day with you.' : 'We’ll arrange a meet and greet with you.',
    };
  }
  if (last.outcome === 'passed') return { state: 'met', action: null };
  return { state: 'not_passed', action: 'Please contact us to talk about next steps.' };
}

export function evaluateDogCompliance(input: EvaluateInput): Evaluation {
  // Licence vaccinations (guidance 9.4) are always mandatory and always block booking (D73),
  // whatever the requirement settings say.
  const reqs = input.requirements.map((r) =>
    r.kind === 'vaccination' && isLicenceVaccination(r.key) ? { ...r, mandatory: true, blocksBooking: true } : r,
  );
  const items: ChecklistItem[] = reqs.map((req) => {
    const base = {
      key: req.key,
      label: req.label,
      kind: req.kind,
      mandatory: req.mandatory,
      blocksBooking: req.blocksBooking,
      expiresOn: null,
      renewalPending: false,
    };
    switch (req.kind) {
      case 'vaccination':
        return {
          ...base,
          ...vaccinationItem(
            req,
            input.submissions.filter((s) => s.status !== 'superseded'),
            input.today,
          ),
        };
      case 'vet_details':
        return {
          ...base,
          state: input.dog.hasVet ? 'met' : 'to_do',
          action: input.dog.hasVet ? null : 'Add your vet’s details.',
        };
      case 'emergency_contact':
        return {
          ...base,
          state: input.hasEmergencyContact ? 'met' : 'to_do',
          action: input.hasEmergencyContact ? null : 'Add at least one emergency contact.',
        };
      case 'onboarding_form':
        return {
          ...base,
          state: input.dog.onboardingSubmitted ? 'met' : 'to_do',
          action: input.dog.onboardingSubmitted ? null : 'Complete and send the onboarding form.',
        };
      case 'terms':
        return {
          ...base,
          state: input.acceptedCurrentTerms ? 'met' : 'to_do',
          action: input.acceptedCurrentTerms ? null : 'Read and accept our current terms.',
        };
      case 'assessment':
        return { ...base, ...assessmentItem(req.key, input.assessments) };
    }
  });

  const valid = (s: ItemState) => s === 'met' || s === 'expiring_soon';
  const mandatory = items.filter((i) => i.mandatory);
  const allMandatoryMet = mandatory.every((i) => valid(i.state));

  const bookingBlockers: string[] = [];
  if (input.dog.status !== 'approved') {
    bookingBlockers.push(
      input.dog.status === 'suspended'
        ? 'Bookings for this dog are paused. Please contact us.'
        : input.dog.status === 'rejected'
          ? 'We are unable to offer day care for this dog at the moment.'
          : 'Your dog needs to be approved by Luna’s K9 Club before booking.',
    );
  }
  const otherBlockers = [...bookingBlockers];
  for (const i of items) {
    if (i.blocksBooking && i.mandatory && !valid(i.state)) {
      let msg: string | null = null;
      if (i.state === 'expired') msg = `${i.label} has expired.`;
      else if (input.dog.status === 'approved') msg = `${i.label}: ${i.action ?? 'waiting for review'}`;
      if (msg) {
        bookingBlockers.push(msg);
        if (i.kind !== 'vaccination') otherBlockers.push(msg);
      }
    }
  }
  const canBook = bookingBlockers.length === 0;

  let overall: OverallStatus;
  if (input.dog.status === 'suspended') overall = 'suspended';
  else if (input.dog.status === 'rejected') overall = 'rejected';
  else if (input.dog.status === 'approved') {
    if (!canBook) overall = 'action_needed';
    else overall = items.some((i) => i.mandatory && i.state === 'expiring_soon') ? 'expiring_soon' : 'approved';
  } else if (allMandatoryMet) overall = 'ready_for_approval';
  else if (items.some((i) => ['rejected', 'replacement_requested', 'not_passed', 'expired'].includes(i.state)))
    overall = 'action_needed';
  else if (items.some((i) => i.state === 'pending_review')) overall = 'pending_review';
  else if (items.every((i) => i.state === 'to_do' || i.state === 'waiting_for_us')) overall = 'not_started';
  else overall = 'in_progress';

  const primaryDates = input.submissions
    .filter((s) => s.status === 'approved' && s.primaryCourseCompletedOn)
    .map((s) => s.primaryCourseCompletedOn!)
    .sort();
  const primaryCourseCompletedOn = primaryDates.at(-1) ?? null;

  return { items, allMandatoryMet, canBook, bookingBlockers, otherBlockers, overall, primaryCourseCompletedOn };
}

export const OVERALL_LABELS: Record<OverallStatus, { text: string; tone: 'info' | 'success' | 'warning' | 'danger' }> =
  {
    not_started: { text: 'Not started', tone: 'info' },
    in_progress: { text: 'In progress', tone: 'info' },
    pending_review: { text: 'Waiting for review', tone: 'info' },
    ready_for_approval: { text: 'Ready for approval', tone: 'info' },
    approved: { text: 'Approved', tone: 'success' },
    expiring_soon: { text: 'Approved – renewal due soon', tone: 'warning' },
    action_needed: { text: 'Action needed', tone: 'warning' },
    suspended: { text: 'Suspended', tone: 'danger' },
    rejected: { text: 'Not accepted', tone: 'danger' },
  };

export const ITEM_LABELS: Record<ItemState, { text: string; tone: 'info' | 'success' | 'warning' | 'danger' }> = {
  met: { text: 'Done', tone: 'success' },
  expiring_soon: { text: 'Expires soon', tone: 'warning' },
  expired: { text: 'Expired', tone: 'danger' },
  pending_review: { text: 'Waiting for review', tone: 'info' },
  rejected: { text: 'Not accepted', tone: 'danger' },
  replacement_requested: { text: 'New copy needed', tone: 'warning' },
  to_do: { text: 'To do', tone: 'info' },
  waiting_for_us: { text: 'We’ll arrange this', tone: 'info' },
  not_passed: { text: 'Not passed', tone: 'danger' },
};
