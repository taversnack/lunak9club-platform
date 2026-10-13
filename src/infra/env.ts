import { z } from 'zod';

const EnvSchema = z.object({
  // APP_ENV is the deployment environment; NODE_ENV is controlled by Next.js.
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  BETTER_AUTH_URL: z.url().optional(),
  EMAIL_TRANSPORT: z.enum(['smtp', 'file', 'console']).default('console'),
  EMAIL_FROM: z.string().default("Luna's K9 Club <no-reply@lunak9club.test>"),
  EMAIL_SANDBOX: z.enum(['0', '1']).default('1'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_DIR: z.string().default('.tmp/mail'),
  AUTH_RATE_LIMIT: z.enum(['on', 'off']).default('on'),
  STORAGE_DRIVER: z.enum(['s3', 'fs']).default('fs'),
  STORAGE_DIR: z.string().default('.data/uploads'),
  S3_ENDPOINT: z.url().optional(),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('eu-west-2'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['0', '1']).default('1'),
  /** Card payments: 'simulated' (development/tests) or 'stripe'. */
  PAYMENTS_DRIVER: z.enum(['simulated', 'stripe']).default('simulated'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  /** Shared secret for the scheduler calling /api/jobs/tick. Unset = endpoint disabled. */
  CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters').optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/** Validated environment. Parsed lazily so `next build` can import modules without runtime secrets. */
export function env(): Env {
  if (cached) return cached;
  // A production server (`next start`) must say which environment it is: defaulting to
  // 'development' would switch off every production check below. Tests and e2e set APP_ENV=test.
  if (process.env.NODE_ENV === 'production' && !process.env.APP_ENV) {
    throw new Error('APP_ENV must be set when running a production build (production, or test for e2e).');
  }
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  if (parsed.data.APP_ENV === 'production') {
    const problems = productionProblems(parsed.data);
    if (problems.length) throw new Error(`Unsafe production configuration: ${problems.join('; ')}`);
  }
  cached = parsed.data;
  return cached;
}

/** Settings whose development defaults are unsafe or broken in production (names only, never values). */
function productionProblems(e: Env): string[] {
  const out: string[] = [];
  if (e.EMAIL_TRANSPORT !== 'smtp') out.push('Production requires a real email transport (EMAIL_TRANSPORT=smtp)');
  if (e.EMAIL_SANDBOX !== '0') out.push('EMAIL_SANDBOX must be 0');
  if (!e.APP_URL.startsWith('https://')) out.push('APP_URL must be an https:// address');
  if (e.PAYMENTS_DRIVER !== 'stripe') out.push('PAYMENTS_DRIVER must be stripe');
  else if (!e.STRIPE_SECRET_KEY || !e.STRIPE_WEBHOOK_SECRET)
    out.push('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required');
  if (e.STORAGE_DRIVER !== 's3') out.push('STORAGE_DRIVER must be s3');
  else if (!e.S3_ENDPOINT || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY)
    out.push('S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required');
  if (!e.CRON_SECRET) out.push('CRON_SECRET is required (the scheduler is off without it)');
  return out;
}
