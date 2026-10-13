import 'server-only';
import { notFound } from 'next/navigation';
import { NotFoundError } from './errors';

/**
 * For pages: a service's NotFoundError (missing, malformed id, or someone else's record, which
 * look the same on purpose) becomes Next's 404 page instead of a 500.
 */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}
