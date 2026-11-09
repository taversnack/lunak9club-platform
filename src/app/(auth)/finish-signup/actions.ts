'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/infra/db/client';
import { runAction, type ActionState } from '@/server/action';
import { clientAddress } from '@/server/rate-limit';
import { finishSignup } from '@/server/services/membership-workflow';

/** Choose a password from the Owner's invite link (D86). No session needed: the link is the proof. */
export async function finishSignupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(fd, async () => {
    await finishSignup(
      getDb(),
      {
        token: String(fd.get('token') ?? ''),
        password: String(fd.get('password') ?? ''),
        confirm: String(fd.get('confirm') ?? ''),
      },
      new Date(),
      { clientAddress: clientAddress(await headers()) },
    );
    redirect('/sign-in?welcome=1');
  });
}
