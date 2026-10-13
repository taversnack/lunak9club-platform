'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getDb } from '@/infra/db/client';
import { getStorage } from '@/infra/storage';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/session';
import { ValidationError } from '@/server/errors';
import { addMyContact, removeMyContact, updateMyProfile } from '@/server/services/customers';
import { createMyDog, saveMyDogVet, submitMyOnboardingForm, updateMyDogDetails } from '@/server/services/dogs';
import { uploadVaccinationRecord } from '@/server/services/documents';
import { acceptTerms } from '@/server/services/policies';
import { cancelMyBooking, createMyBookings, leaveWaitlist } from '@/server/services/bookings';
import { withdrawMyApprovalRequest } from '@/server/services/approvals';
import { startInvoiceCheckout } from '@/server/services/payments';
import { acknowledgeIncident } from '@/server/services/welfare';
import { requestErasure, withdrawErasureRequest } from '@/server/services/privacy';
import type { Route } from 'next';
import { leaveMembership, withdrawMembershipRequest } from '@/server/services/memberships';
import {
  confirmMyMonth,
  confirmMyOffer,
  requestMyMembershipDays,
  requestMyMoveOnce,
} from '@/server/services/membership-workflow';
import { formatUkDate } from '@/domain/time';

export async function payInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const { url } = await startInvoiceCheckout(getDb(), actor, String(fd.get('invoiceId') ?? ''));
    redirect(url as Route);
  });
}

const obj = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));

export async function saveProfileAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await updateMyProfile(getDb(), actor, obj(fd));
    revalidatePath('/account');
    return { status: 'success', message: 'Your details are saved.' };
  });
}

export async function addContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await addMyContact(getDb(), actor, obj(fd));
    revalidatePath('/account/contacts');
    return { status: 'success', message: 'Contact added.' };
  });
}

export async function removeContactAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await removeMyContact(getDb(), actor, String(fd.get('contactId') ?? ''));
    revalidatePath('/account/contacts');
    return { status: 'success', message: 'Contact removed.' };
  });
}

export async function acceptTermsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    if (fd.get('agree') !== 'on')
      throw new ValidationError('Please tick the box to accept the terms.', { agree: 'Tick to accept the terms' });
    await acceptTerms(getDb(), actor, String(fd.get('versionId') ?? ''));
    revalidatePath('/account');
    return { status: 'success', message: 'Thank you – you’ve accepted the terms.' };
  });
}

export async function createDogAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const id = await createMyDog(getDb(), actor, obj(fd));
    redirect(`/account/dogs/${id}`);
  });
}

export async function updateDogAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const dogId = String(fd.get('dogId') ?? '');
    await updateMyDogDetails(getDb(), actor, dogId, obj(fd));
    redirect(`/account/dogs/${dogId}?saved=details`);
  });
}

export async function saveVetAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const dogId = String(fd.get('dogId') ?? '');
    await saveMyDogVet(getDb(), actor, dogId, obj(fd));
    redirect(`/account/dogs/${dogId}?saved=vet`);
  });
}

export async function submitOnboardingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const dogId = String(fd.get('dogId') ?? '');
    await submitMyOnboardingForm(getDb(), actor, dogId, obj(fd));
    redirect(`/account/dogs/${dogId}?saved=onboarding`);
  });
}

export async function uploadVaccinationAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const dogId = String(fd.get('dogId') ?? '');
    const file = fd.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new ValidationError('Please check the highlighted fields.', {
        file: 'Choose a photo or PDF of the vaccination record',
      });
    }
    if (file.size > 10 * 1024 * 1024)
      throw new ValidationError('Please check the highlighted fields.', { file: 'The file is larger than 10 MB.' });
    const entries = fd
      .getAll('covers')
      .map(String)
      .map((key) => ({
        requirementKey: key,
        expiresOn: String(fd.get(`expiresOn.${key}`) ?? ''),
        administeredOn: String(fd.get(`administeredOn.${key}`) ?? ''),
      }));
    await uploadVaccinationRecord(getDb(), getStorage(), actor, {
      dogId,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      entries,
      firstCourse: fd.get('firstCourse'),
      primaryCourseCompletedOn: fd.get('primaryCourseCompletedOn'),
    });
    redirect(`/account/dogs/${dogId}?saved=upload`);
  });
}

// ---- Bookings (Phase 3) ------------------------------------------------------

export async function confirmBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const r = await createMyBookings(getDb(), actor, {
      dogIds: fd.getAll('dog').map(String),
      dates: fd.getAll('date').map(String),
      session: String(fd.get('session') ?? ''),
      taxi: fd.get('taxi') === '1',
      ifFull: String(fd.get('ifFull') ?? 'waitlist'),
      customerNote: String(fd.get('customerNote') ?? ''),
      trial: fd.get('trial') === '1',
    });
    const n = (k: string) => r.outcomes.filter((o) => o.outcome === k).length;
    revalidatePath('/account/bookings');
    // Nothing is charged until the Owner approves (D76, D78).
    redirect(`/account/bookings?requested=${n('requested')}&waitlisted=${n('waitlisted')}&skipped=${n('skipped')}`);
  });
}

export async function cancelBookingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const { late, refundedPence } = await cancelMyBooking(getDb(), actor, String(fd.get('bookingId') ?? ''));
    revalidatePath('/account/bookings');
    redirect(`/account/bookings?cancelled=${late ? 'late' : refundedPence ? 'refunded' : 'free'}`);
  });
}

/** Leave the waitlist (D81). On-screen confirmation only – no email. */
export async function leaveWaitlistAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await leaveWaitlist(getDb(), actor, String(fd.get('bookingId') ?? ''));
    revalidatePath('/account/bookings');
    redirect('/account/bookings?left=waitlist');
  });
}

/** Withdraw a whole booking request (D79). No charge; the standard "withdrawn" email follows. */
export async function withdrawRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await withdrawMyApprovalRequest(getDb(), actor, String(fd.get('requestId') ?? ''));
    revalidatePath('/account/bookings');
    redirect('/account/bookings?withdrawn=1');
  });
}

// ---- Memberships (Phase 4) -----------------------------------------------------

/** Choose or change a dog's regular days; goes to the Owner for approval (D87, D89). */
export async function requestMembershipDaysAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const r = await requestMyMembershipDays(getDb(), actor, {
      ...obj(fd),
      weekdays: fd.getAll('weekdays').map(String),
    });
    revalidatePath('/account/membership');
    return {
      status: 'success',
      message: `Thanks – we’ll check there’s space and confirm. The days would start on ${formatUkDate(r.startsOn)}.`,
    };
  });
}

/** Confirm the Owner's days unchanged for a dog (D87). */
export async function confirmOfferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await confirmMyOffer(getDb(), actor, obj(fd));
    revalidatePath('/account/membership');
    return { status: 'success', message: 'Thanks – your days are confirmed and booked ahead.' };
  });
}

/** Confirm a month's membership days (D88). */
export async function confirmMonthAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await confirmMyMonth(getDb(), actor, obj(fd));
    revalidatePath('/account/membership');
    return { status: 'success', message: 'Thanks – your days are confirmed.' };
  });
}

/** Move one membership day, this occasion only; goes to the Owner for approval (D90). */
export async function requestMoveOnceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await requestMyMoveOnce(getDb(), actor, obj(fd));
    revalidatePath('/account/bookings');
    return {
      status: 'success',
      message: 'Thanks – we’ll check and confirm the move. Your day stays booked until then.',
    };
  });
}

/** "This occasion only" → a move request; "all future months" → the Membership page to change days (D90). */
export async function moveMembershipDayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    if (fd.get('scope') === 'future') redirect('/account/membership#yours');
    if (fd.get('scope') !== 'once')
      return { status: 'error', message: 'Please choose an option.', fields: { scope: 'Choose an option' } };
    await requestMyMoveOnce(getDb(), actor, obj(fd));
    revalidatePath('/account/bookings');
    redirect('/account/bookings?moveRequested=1');
  });
}

/** Withdraw one of your own requests that is still waiting (membership days, moves). */
export async function withdrawApprovalAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await withdrawMyApprovalRequest(getDb(), actor, String(fd.get('id') ?? ''));
    revalidatePath('/account/membership');
    revalidatePath('/account/bookings');
    return { status: 'success', message: 'Request withdrawn.' };
  });
}

export async function withdrawMembershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await withdrawMembershipRequest(getDb(), actor, String(fd.get('id') ?? ''));
    revalidatePath('/account/membership');
    return { status: 'success', message: 'Request withdrawn.' };
  });
}

export async function leaveMembershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    if (fd.get('confirm') !== 'on') {
      return { status: 'error', message: 'Tick the box to confirm.', fields: { confirm: 'Tick to confirm' } };
    }
    const { endsOn } = await leaveMembership(getDb(), actor, String(fd.get('id') ?? ''));
    revalidatePath('/account/membership');
    return {
      status: 'success',
      message: `Your membership ends after ${formatUkDate(endsOn)}. Later booked days have been cancelled free of charge.`,
    };
  });
}

// ---- Incidents and your data (Phase 7) ---------------------------------------------------

export async function acknowledgeIncidentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await acknowledgeIncident(getDb(), actor, String(fd.get('id') ?? ''));
    revalidatePath('/account');
    return { status: 'success', message: 'Thank you – we’ve noted that you’ve read this.' };
  });
}

export async function requestErasureAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await requestErasure(getDb(), actor, obj(fd));
    redirect('/account/data?done=requested');
  });
}

export async function withdrawErasureAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    await withdrawErasureRequest(getDb(), actor);
    redirect('/account/data?done=withdrawn');
  });
}
