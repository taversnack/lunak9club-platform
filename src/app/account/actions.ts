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
import { acceptOffer, cancelMyBooking, createMyBookings } from '@/server/services/bookings';
import { startInvoiceCheckout } from '@/server/services/payments';
import { acknowledgeIncident } from '@/server/services/welfare';
import { requestErasure, withdrawErasureRequest } from '@/server/services/privacy';
import type { Route } from 'next';
import { leaveMembership, requestMembership, withdrawMembershipRequest } from '@/server/services/memberships';

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
      .map((key) => ({ requirementKey: key, expiresOn: String(fd.get(`expiresOn.${key}`) ?? '') }));
    await uploadVaccinationRecord(getDb(), getStorage(), actor, {
      dogId,
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      entries,
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
    });
    const n = (k: string) => r.outcomes.filter((o) => o.outcome === k).length;
    revalidatePath('/account/bookings');
    // Priced places are held while the customer pays on the card payment page (D6).
    if (r.checkoutUrl) redirect(r.checkoutUrl as Route);
    redirect(`/account/bookings?booked=${n('confirmed')}&waitlisted=${n('waitlisted')}&skipped=${n('skipped')}`);
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

export async function acceptOfferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const r = await acceptOffer(getDb(), actor, String(fd.get('bookingId') ?? ''));
    revalidatePath('/account/bookings');
    if (r.checkoutUrl) redirect(r.checkoutUrl as Route);
    return { status: 'success', message: 'Place accepted – see you then!' };
  });
}

// ---- Memberships (Phase 4) -----------------------------------------------------

export async function requestMembershipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('account.access');
    const changeOf = String(fd.get('changeOf') ?? '') || undefined;
    const r = await requestMembership(
      getDb(),
      actor,
      { ...obj(fd), weekdays: fd.getAll('weekdays').map(String) },
      { changeOf },
    );
    revalidatePath('/account/membership');
    return {
      status: 'success',
      message: changeOf
        ? `Thanks – we’ll confirm your new days, starting ${r.startsOn}.`
        : 'Thanks – we’ll review your membership request and email you.',
    };
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
      message: `Your membership ends after ${endsOn}. Later booked days have been cancelled free of charge.`,
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
