'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/infra/db/client';
import { runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/session';
import { approveApprovalRequest, rejectApprovalRequest } from '@/server/services/approvals';

const note = (fd: FormData) => {
  const v = fd.get('reason');
  return { reason: typeof v === 'string' ? v : undefined };
};

export async function approveRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('approvals.manage');
    await approveApprovalRequest(getDb(), actor, String(fd.get('id') ?? ''), note(fd));
    revalidatePath('/admin/approvals');
    redirect('/admin/approvals?approved=1');
  });
}

export async function declineRequestAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    const actor = await requirePermission('approvals.manage');
    await rejectApprovalRequest(getDb(), actor, String(fd.get('id') ?? ''), note(fd));
    revalidatePath('/admin/approvals');
    redirect('/admin/approvals?declined=1');
  });
}
