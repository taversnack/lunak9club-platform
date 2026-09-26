'use server';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/infra/db/client';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/session';
import { recordAssessment, reviewSubmission, setDogStatus, updateRequirement } from '@/server/services/owner-review';
import { publishTerms } from '@/server/services/policies';
import { redirect } from 'next/navigation';
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
