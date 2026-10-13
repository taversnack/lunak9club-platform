/**
 * Runs once when a Next.js server starts. A production server checks its configuration here, so a
 * deploy with missing or unsafe settings fails at once rather than on the first request that needs
 * them. Skipped during `next build`, which runs without runtime secrets, and in development.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { env } = await import('./infra/env');
  env();
}
