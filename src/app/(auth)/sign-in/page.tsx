import type { Metadata } from 'next';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; verified?: string }>;
}) {
  const sp = await searchParams;
  return <SignInForm notice={sp.reset === '1' ? 'reset' : sp.verified === '1' ? 'verified' : undefined} />;
}
