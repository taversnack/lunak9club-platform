'use server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/infra/db/client';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/session';
import { recordAssessment, reviewSubmission, setDogStatus, updateRequirement } from '@/server/services/owner-review';
import { publishTerms } from '@/server/services/policies';
import {
  addCustomerRate,
  endCustomerRate,
  removeScheduledPriceBook,
  schedulePriceBook,
} from '@/server/services/pricing';
import {
  approveMembership,
  declineMembership,
  materialiseMemberships,
  ownerEndMembership,
} from '@/server/services/memberships';
import { redirect } from 'next/navigation';
import {
  approveInvoice,
  decideRefund,
  issueCreditNote,
  markCreditRefunded,
  recordManualPayment,
  resendInvoice,
  unapproveInvoice,
  updateBusinessSettings,
} from '@/server/services/billing';
import { runBillingNow } from '@/server/services/jobs';
import { retryCardRefund } from '@/server/services/card-refunds';
import {
  addIncidentUpdate,
  recordWelfareCheck,
  reportIncident,
  setIncidentStatus,
  setWelfareShared,
} from '@/server/services/welfare';
import { decideErasure } from '@/server/services/privacy';
import { getStorage } from '@/infra/storage';
import {
  addClosure,
  checkIn,
  checkOut,
  markNoShow,
  offerPlace,
  ownerCancel,
  ownerCreateBooking,
  removeClosure,
  setDayCapacity,
  setInternalNote,
  undoAttendance,
  updateBookingSettings,
} from '@/server/services/owner-bookings';

const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function reviewSubmissionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('compliance.review');
    await reviewSubmission(getDb(), actor, String(fd.get('submissionId') ?? ''), obj(fd));
    revalidatePath(`/admin/dogs/${String(fd.get('dogId') ?? '')}`);
    revalidatePath('/admin/reviews');
    return { status: 'success', message: 'Decision saved.' };
  });
}

export async function recordAssessmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('assessments.manage');
    const dogId = String(fd.get('dogId') ?? '');
    await recordAssessment(getDb(), actor, dogId, obj(fd));
    revalidatePath(`/admin/dogs/${dogId}`);
    return { status: 'success', message: 'Assessment recorded.' };
  });
}

export async function setDogStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('dogs.approve');
    const dogId = String(fd.get('dogId') ?? '');
    await setDogStatus(getDb(), actor, dogId, obj(fd));
    revalidatePath(`/admin/dogs/${dogId}`);
    return { status: 'success', message: 'Status updated.' };
  });
}

export async function updateRequirementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('requirements.manage');
    await updateRequirement(getDb(), actor, String(fd.get('key') ?? ''), obj(fd));
    revalidatePath('/admin/settings/requirements');
    return { status: 'success', message: 'Saved.' };
  });
}

export async function publishTermsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('policies.manage');
    if (fd.get('confirm') !== 'on') {
      return {
        status: 'error',
        message: 'Tick the box to confirm every customer will need to accept the new terms.',
        fields: { confirm: 'Tick to confirm' },
      };
    }
    const v = await publishTerms(getDb(), actor, obj(fd));
    revalidatePath('/admin/settings/terms');
    return { status: 'success', message: `Version ${v} published. Customers will be asked to accept it.` };
  });
}

// ---- Bookings and attendance (Phase 3) ----------------------------------------

const attendanceOps = { checkIn, checkOut, markNoShow, undoAttendance } as const;

export async function attendanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('attendance.manage');
    const op = String(fd.get('op') ?? '') as keyof typeof attendanceOps;
    const fn = attendanceOps[op];
    if (!fn) return { status: 'error', message: 'Unknown action.' };
    await fn(getDb(), actor, String(fd.get('id') ?? ''), obj(fd));
    revalidatePath('/admin/bookings');
    return { status: 'success', message: 'Saved.' };
  });
}

export async function offerPlaceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('bookings.manage');
    await offerPlace(getDb(), actor, String(fd.get('id') ?? ''), obj(fd));
    revalidatePath('/admin/bookings');
    return { status: 'success', message: 'Place offered – the customer has been emailed.' };
  });
}

export async function ownerCancelAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('bookings.manage');
    await ownerCancel(getDb(), actor, String(fd.get('id') ?? ''), obj(fd));
    revalidatePath('/admin/bookings');
    return { status: 'success', message: 'Booking cancelled – the customer has been emailed.' };
  });
}

export async function internalNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('bookings.manage');
    await setInternalNote(getDb(), actor, String(fd.get('id') ?? ''), obj(fd));
    revalidatePath('/admin/bookings');
    return { status: 'success', message: 'Note saved.' };
  });
}

export async function ownerBookAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('bookings.manage');
    await ownerCreateBooking(getDb(), actor, obj(fd));
    redirect(`/admin/bookings?date=${String(fd.get('date') ?? '')}`);
  });
}

export async function dayCapacityAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('availability.manage');
    await setDayCapacity(getDb(), actor, obj(fd));
    revalidatePath('/admin/bookings');
    return { status: 'success', message: 'Capacity updated for this day.' };
  });
}

export async function addClosureAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('availability.manage');
    await addClosure(getDb(), actor, obj(fd));
    revalidatePath('/admin/settings/availability');
    return { status: 'success', message: 'Closure added.' };
  });
}

export async function removeClosureAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('availability.manage');
    await removeClosure(getDb(), actor, String(fd.get('date') ?? ''));
    revalidatePath('/admin/settings/availability');
    return { status: 'success', message: 'Closure removed.' };
  });
}

export async function bookingSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('availability.manage');
    await updateBookingSettings(getDb(), actor, { ...obj(fd), openWeekdays: fd.getAll('openWeekdays').map(String) });
    revalidatePath('/admin/settings/availability');
    return { status: 'success', message: 'Settings saved.' };
  });
}

// ---- Pricing and memberships (Phase 4) -----------------------------------------------

export async function schedulePricesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('pricing.manage');
    await schedulePriceBook(getDb(), actor, obj(fd));
    revalidatePath('/admin/settings/pricing');
    return { status: 'success', message: 'New prices scheduled. Existing bookings keep their prices.' };
  });
}

export async function removePricesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('pricing.manage');
    await removeScheduledPriceBook(getDb(), actor, String(fd.get('id') ?? ''));
    revalidatePath('/admin/settings/pricing');
    return { status: 'success', message: 'Scheduled prices removed.' };
  });
}

export async function addCustomerRateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('pricing.manage');
    const customerId = String(fd.get('customerId') ?? '');
    await addCustomerRate(getDb(), actor, customerId, obj(fd));
    revalidatePath(`/admin/customers/${customerId}`);
    return { status: 'success', message: 'Rate added.' };
  });
}

export async function endCustomerRateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('pricing.manage');
    await endCustomerRate(getDb(), actor, String(fd.get('id') ?? ''));
    revalidatePath(`/admin/customers/${String(fd.get('customerId') ?? '')}`);
    return { status: 'success', message: 'Rate ended.' };
  });
}

export async function approveMembershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('memberships.manage');
    const r = await approveMembership(getDb(), actor, String(fd.get('id') ?? ''), obj(fd));
    revalidatePath('/admin/memberships');
    redirect(`/admin/memberships?approved=${r.booked}&waitlisted=${r.waitlisted}&blocked=${r.skippedBlocked}`);
  });
}

export async function declineMembershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('memberships.manage');
    await declineMembership(getDb(), actor, String(fd.get('id') ?? ''), obj(fd));
    revalidatePath('/admin/memberships');
    redirect('/admin/memberships?declined=1');
  });
}

export async function endMembershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('memberships.manage');
    await ownerEndMembership(getDb(), actor, String(fd.get('id') ?? ''), obj(fd));
    revalidatePath('/admin/memberships');
    return { status: 'success', message: 'Membership end date set; later days cancelled free of charge.' };
  });
}

export async function bookAheadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('memberships.manage');
    const r = await materialiseMemberships(getDb(), actor);
    revalidatePath('/admin/memberships');
    return {
      status: 'success',
      message: `Booked ${r.booked} new membership days${r.waitlisted ? `, ${r.waitlisted} waitlisted (full)` : ''}${r.skippedBlocked ? `, ${r.skippedBlocked} not booked (vaccination or approval)` : ''}.`,
    };
  });
}

// ---- Invoices and refunds (Phase 5) ---------------------------------------------------

export async function approveInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('invoices.manage');
    const id = String(fd.get('id') ?? '');
    const r = await approveInvoice(getDb(), actor, id, obj(fd));
    revalidatePath('/admin/invoices');
    redirect(`/admin/invoices/${id}?done=${r.sentNow ? 'sent' : 'scheduled'}`);
  });
}

export async function unapproveInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('invoices.manage');
    const id = String(fd.get('id') ?? '');
    await unapproveInvoice(getDb(), actor, id, obj(fd));
    redirect(`/admin/invoices/${id}?done=unapproved`);
  });
}

export async function resendInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('invoices.manage');
    await resendInvoice(getDb(), actor, String(fd.get('id') ?? ''));
    return { status: 'success', message: 'Invoice emailed to the customer again.' };
  });
}

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('invoices.manage');
    const id = String(fd.get('id') ?? '');
    await recordManualPayment(getDb(), actor, id, obj(fd));
    redirect(`/admin/invoices/${id}?done=payment`);
  });
}

export async function creditInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('invoices.manage');
    const id = String(fd.get('id') ?? '');
    await issueCreditNote(getDb(), actor, id, {
      ...obj(fd),
      lineIds: fd.getAll('lineIds').filter((v): v is string => typeof v === 'string'),
    });
    redirect(`/admin/invoices/${id}?done=credited`);
  });
}

export async function runBillingNowAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('invoices.manage');
    const r = await runBillingNow(getDb(), actor);
    revalidatePath('/admin/invoices');
    redirect(`/admin/invoices?ran=1&drafts=${r.drafts}&sent=${r.sent}&reminders=${r.reminders}`);
  });
}

export async function decideRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('refunds.manage');
    const approve = fd.get('decision') === 'approve';
    await decideRefund(getDb(), actor, String(fd.get('id') ?? ''), approve, obj(fd));
    redirect(`/admin/refunds?done=${approve ? 'approved' : 'declined'}`);
  });
}

export async function markRefundedAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('refunds.manage');
    await markCreditRefunded(getDb(), actor, String(fd.get('id') ?? ''), obj(fd));
    redirect('/admin/refunds?done=refunded');
  });
}

export async function updateBusinessSettingsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('settings.manage');
    await updateBusinessSettings(getDb(), actor, obj(fd));
    revalidatePath('/admin/settings/business');
    return { status: 'success', message: 'Business details saved.' };
  });
}

export async function retryCardRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('refunds.manage');
    await retryCardRefund(getDb(), actor, String(fd.get('id') ?? ''));
    redirect('/admin/refunds?done=retried');
  });
}

// ---- Welfare, incidents and data requests (Phase 7) -------------------------------------

export async function reportIncidentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('incidents.manage');
    const files = fd.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0);
    const photos = await Promise.all(
      files.map(async (f) => ({ fileName: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
    );
    const id = await reportIncident(getDb(), getStorage(), actor, obj(fd), photos);
    redirect(`/admin/incidents/${id}?done=reported`);
  });
}

export async function incidentUpdateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('incidents.manage');
    const id = String(fd.get('id') ?? '');
    await addIncidentUpdate(getDb(), actor, id, obj(fd));
    redirect(`/admin/incidents/${id}?done=updated`);
  });
}

export async function incidentStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('incidents.manage');
    const id = String(fd.get('id') ?? '');
    const close = fd.get('close') === '1';
    await setIncidentStatus(getDb(), actor, id, close);
    redirect(`/admin/incidents/${id}?done=${close ? 'closed' : 'reopened'}`);
  });
}

export async function welfareCheckAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('welfare.manage');
    const r = await recordWelfareCheck(getDb(), actor, {
      ...obj(fd),
      concerns: fd.getAll('concerns').filter((v): v is string => typeof v === 'string'),
    });
    const dogId = String(fd.get('dogId') ?? '');
    revalidatePath(`/admin/dogs/${dogId}`);
    return {
      status: 'success',
      message: r.autoShared
        ? 'Check saved. Because it records something the customer must be told about, it’s been shared and they’ve been emailed.'
        : r.shared
          ? 'Check saved and shared with the customer.'
          : 'Check saved.',
    };
  });
}

export async function welfareShareAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('welfare.manage');
    await setWelfareShared(getDb(), actor, String(fd.get('id') ?? ''), fd.get('shared') === '1');
    revalidatePath(`/admin/dogs/${String(fd.get('dogId') ?? '')}`);
    return { status: 'success', message: fd.get('shared') === '1' ? 'Shared with the customer.' : 'No longer shared.' };
  });
}

export async function decideErasureAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('data_requests.manage');
    const approve = fd.get('decision') === 'approve';
    const r = await decideErasure(getDb(), getStorage(), actor, String(fd.get('id') ?? ''), approve, obj(fd));
    redirect(`/admin/data-requests?done=${approve ? (r.completed ? 'erased' : 'closed') : 'declined'}`);
  });
}
