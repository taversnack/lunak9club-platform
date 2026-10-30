'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/infra/db/client';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/session';
import { approveApprovalRequest, rejectApprovalRequest } from '@/server/services/approvals';

// Only the Today inbox may ask to come back to it; anything else goes to the Requests page.
const backTo = (fd: FormData, done: 'approved' | 'declined') =>
  fd.get('from') === 'today' ? `/admin?${done}=1` : `/admin/approvals?${done}=1`;

const note = (fd: FormData) => {
  const v = fd.get('reason');
  return { reason: typeof v === 'string' ? v : undefined };
};

export async function approveRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('approvals.manage');
    await approveApprovalRequest(getDb(), actor, String(fd.get('id') ?? ''), note(fd));
    revalidatePath('/admin/approvals');
    revalidatePath('/admin');
    redirect(backTo(fd, 'approved'));
  });
}

export async function declineRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('approvals.manage');
    await rejectApprovalRequest(getDb(), actor, String(fd.get('id') ?? ''), note(fd));
    revalidatePath('/admin/approvals');
    revalidatePath('/admin');
    redirect(backTo(fd, 'declined'));
  });
}
