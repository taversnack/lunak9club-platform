import { redirect } from 'next/navigation';
import { getActor } from '@/server/session';
import { authorize } from '@/server/policy/authorize';

export const dynamic = 'force-dynamic';

/** Sends each signed-in person to the right home page. */
export default async function DashboardRedirect() {
  const actor = await getActor();
  if (actor.kind === 'anonymous') redirect('/sign-in');
  if (!actor.emailVerified) redirect('/verify-email');
  if (authorize(actor, 'admin.access').allowed) redirect('/admin');
  redirect('/account');
}
