import type { Metadata } from 'next';
import { SignInForm } from './sign-in-form';
import { safeCallbackPath } from '@/domain/auth/callback-url';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; verified?: string; welcome?: string; callbackUrl?: string | string[] }>;
}) {
  const sp = await searchParams;
  return (
    <SignInForm
      notice={
        sp.reset === '1' ? 'reset' : sp.verified === '1' ? 'verified' : sp.welcome === '1' ? 'welcome' : undefined
      }
      // Validated here (same-origin path or the dashboard) and again in the form.
      callbackUrl={safeCallbackPath(sp.callbackUrl)}
    />
  );
}
