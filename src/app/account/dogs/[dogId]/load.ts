import 'server-only';
import { notFound } from 'next/navigation';
import { getDb } from '@/infra/db/client';
import { requirePermission } from '@/server/session';
import { NotFoundError } from '@/server/errors';
import { getMyDog } from '@/server/services/dogs';

/** Load one of the signed-in customer's dogs, or show 404 (also for other customers' dogs). */
export async function loadDogPage(dogId: string) {
  const actor = await requirePermission('account.access');
  try {
    return await getMyDog(getDb(), actor, dogId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
