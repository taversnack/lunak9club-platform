/**
 * Runs once when a Next.js server starts. A production server checks its configuration here, so a
 * deploy with missing or unsafe settings fails at once rather than on the first request that needs
 * them. Skipped during `next build`, which runs without runtime secrets, and in development.
 *
 * A bad configuration stops the process (exit code 1). Throwing here isn't enough: Next.js logs
 * the error and keeps the server up, answering every request with a 500 while looking healthy to
 * the host. Exiting makes the deploy fail visibly and lets the platform keep the previous release.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { env } = await import('./infra/env');
  try {
    env();
  } catch (err) {
    console.error(`Refusing to start: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
