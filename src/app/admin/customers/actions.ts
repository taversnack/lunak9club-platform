'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import type { Route } from 'next';
import { getDb } from '@/infra/db/client';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/session';
import {
  ownerConfirmMonth,
  ownerCreateCustomer,
  ownerSetMembershipDays,
  resendCustomerInvite,
} from '@/server/services/membership-workflow';
import { formatUkDate } from '@/domain/time';

const MAX_DOGS = 3;

/** Owner creates a customer account with each dog's agreed days, and the invite is emailed (D86, D87). */
export async function createCustomerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('users.manage');
    const dogs = [];
    for (let i = 0; i < MAX_DOGS; i++) {
      const dogName = String(fd.get(`dogs.${i}.dogName`) ?? '').trim();
      if (!dogName) continue;
      dogs.push({
        dogName,
        weekdays: fd.getAll(`dogs.${i}.weekdays`).map(String),
        session: String(fd.get(`dogs.${i}.session`) ?? 'full'),
        taxi: fd.get(`dogs.${i}.taxi`) === 'on',
        startsOn: String(fd.get(`dogs.${i}.startsOn`) ?? ''),
      });
    }
    const { customerId } = await ownerCreateCustomer(getDb(), actor, {
      name: String(fd.get('name') ?? ''),
      email: String(fd.get('email') ?? ''),
      dogs,
    });
    revalidatePath('/admin/customers');
    redirect(`/admin/customers/${customerId}?created=1` as Route);
  });
}

export async function resendInviteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('users.manage');
    const id = String(fd.get('customerId') ?? '');
    await resendCustomerInvite(getDb(), actor, id);
    revalidatePath(`/admin/customers/${id}`);
    return { status: 'success', message: 'A new link has been sent. It works once and expires in 7 days.' };
  });
}

/** Owner sets or changes a dog's regular days directly, no approval; the customer is emailed (D89). */
export async function ownerSetDaysAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('memberships.manage');
    const r = await ownerSetMembershipDays(getDb(), actor, String(fd.get('dogId') ?? ''), {
      weekdays: fd.getAll('weekdays').map(String),
      session: String(fd.get('session') ?? ''),
      taxi: fd.get('taxi') === 'on',
      startsOn: String(fd.get('startsOn') ?? '') || undefined,
    });
    revalidatePath(`/admin/customers/${String(fd.get('customerId') ?? '')}`);
    return {
      status: 'success',
      message: `Saved – the new days start on ${formatUkDate(r.startsOn)}. ${r.booked} days booked ahead${r.waitlisted ? `, ${r.waitlisted} waitlisted` : ''}. The customer has been emailed.`,
    };
  });
}

/** Owner confirms a month's days for the customer (D88). */
export async function ownerConfirmMonthAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('memberships.manage');
    const id = String(fd.get('customerId') ?? '');
    await ownerConfirmMonth(getDb(), actor, id, { month: String(fd.get('month') ?? '') });
    revalidatePath(`/admin/customers/${id}`);
    revalidatePath('/admin');
    return { status: 'success', message: 'Days confirmed for the customer.' };
  });
}
