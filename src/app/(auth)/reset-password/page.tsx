import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordForm } from './reset-form';
import { Stack } from '@/ui/components';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  if (!token || error) {
    return (
      <Stack>
        <h1>Link not valid</h1>
        <p>This reset link has expired or was already used.</p>
        <p>
          <Link href="/forgot-password">Request a new link</Link>
        </p>
      </Stack>
    );
  }
  return <ResetPasswordForm token={token} />;
}
