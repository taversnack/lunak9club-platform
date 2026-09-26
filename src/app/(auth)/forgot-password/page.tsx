'use client';
import Link from 'next/link';
import { useState } from 'react';
import { authClient } from '@/infra/auth/client';
import { Alert, Button, Field, Stack } from '@/ui/components';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get('email') ?? '');
    await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' });
    setPending(false);
    setSent(true);
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack>
        <h1>Reset your password</h1>
        {sent ? (
          <Alert tone="success" title="Check your email">
            If there&apos;s an account for that address, we&apos;ve sent a link to reset your password. It lasts 1 hour.
          </Alert>
        ) : (
          <p>Enter the email address you signed up with and we&apos;ll send you a reset link.</p>
        )}
        <Field label="Email address" name="email" type="email" autoComplete="email" required />
        <Button type="submit" full disabled={pending}>
          Send reset link
        </Button>
        <p>
          <Link href="/sign-in">Back to sign in</Link>
        </p>
      </Stack>
    </form>
  );
}
