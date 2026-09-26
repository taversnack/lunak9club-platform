import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { logger } from '@/infra/logger';
import { AuthorizationError } from './policy/authorize';
import { ConflictError, NotFoundError, ValidationError } from './errors';

export type ActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fields?: Record<string, string>;
  /** Submitted text values, echoed back so the form keeps what the person typed after an error. */
  values?: Record<string, string>;
};

export const initialActionState: ActionState = { status: 'idle' };

const SENSITIVE_ECHO = /password|token|file/i;

export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === 'string' && !SENSITIVE_ECHO.test(k) && !k.startsWith('$')) out[k] = v;
  }
  return out;
}

/**
 * Run a server action body and turn known errors into form state. Redirects and
 * notFound() pass straight through. Unknown errors are logged without input data.
 */
export async function runAction(fd: FormData, fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { status: 'success' };
  } catch (err) {
    unstable_rethrow(err);
    const values = formValues(fd);
    if (err instanceof ValidationError) return { status: 'error', message: err.message, fields: err.fields, values };
    if (err instanceof ConflictError) return { status: 'error', message: err.message, values };
    if (err instanceof NotFoundError)
      return { status: 'error', message: 'We couldn’t find that. It may have been removed.', values };
    if (err instanceof AuthorizationError) return { status: 'error', message: 'You don’t have permission to do that.' };
    logger.error({ err: err instanceof Error ? err.name : 'unknown' }, 'action failed');
    return { status: 'error', message: 'Something went wrong on our side. Please try again.', values };
  }
}
