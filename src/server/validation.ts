import { z } from 'zod';
import { NotFoundError, ValidationError } from './errors';
import { isIsoDate } from '@/domain/time';

/** Parse input with a Zod schema, turning failures into a ValidationError with per-field messages. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const k = issue.path.join('.') || 'form';
    fields[k] ??= issue.message;
  }
  throw new ValidationError('Please check the highlighted fields.', fields);
}

const trimmed = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`);
export const optionalText = (max = 2000) =>
  trimmed(max)
    .optional()
    .transform((v) => (v ? v : null));
export const requiredText = (label: string, max = 200) => trimmed(max).min(1, `Enter ${label}`);

export const ukPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .refine((v) => /^(\+44|0)\d{9,10}$/.test(v), 'Enter a UK phone number, like 07700 900123');

export const ukPostcode = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/\s+/g, ''))
  .refine((v) => /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(v), 'Enter a valid UK postcode')
  .transform((v) => `${v.slice(0, -3)} ${v.slice(-3)}`);

export const isoDate = (label: string) => z.string().trim().refine(isIsoDate, `Enter ${label} as a real date`);

/** HTML checkbox → boolean. */
export const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Route/form ids: anything that isn't a UUID simply doesn't exist. */
export function idOrNotFound(id: unknown, what = 'Record'): string {
  if (typeof id !== 'string' || !UUID.test(id)) throw new NotFoundError(what);
  return id;
}
