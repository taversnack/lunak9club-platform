'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/infra/auth/client';
import { Alert, Button, Field, Stack } from '@/ui/components';

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password') ?? '');
    if (password.length < 10) return setError('Use at least 10 characters');
    if (password !== String(f.get('confirm') ?? '')) return setError('Passwords do not match');
    setPending(true);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (err) return setError('This reset link has expired or was already used. Please request a new one.');
    router.push('/sign-in?reset=1');
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <h1>Choose a new password</h1>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters"
          required
        />
        <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
        <Button type="submit" full disabled={pending}>
          Save new password
        </Button>
      </Stack>
    </form>
  );
}
