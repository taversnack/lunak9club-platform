import type { Metadata } from 'next';
import { ResendVerification } from './resend';
import { Stack } from '@/ui/components';

export const metadata: Metadata = { title: 'Confirm your email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const { email, error } = await searchParams;
  return (
    <Stack>
      <h1>Check your email</h1>
      {error ? (
        <p>That confirmation link has expired or was already used. Request a new one below.</p>
      ) : (
        <p>
          We&apos;ve sent a confirmation link{email ? ' to the address you gave us' : ''}. Open it to finish setting up
          your account. The link lasts 1 hour.
        </p>
      )}
      <ResendVerification defaultEmail={email ?? ''} />
    </Stack>
  );
}
