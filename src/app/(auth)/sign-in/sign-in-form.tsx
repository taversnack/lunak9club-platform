'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/infra/auth/client';
import { Alert, Button, Field, Stack } from '@/ui/components';

export function SignInForm({ notice }: { notice?: 'reset' | 'verified' }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setUnverified(false);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const { error: err } = await authClient.signIn.email({
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      callbackURL: '/dashboard',
    });
    setPending(false);
    if (err) {
      if (err.status === 403) {
        setUnverified(true);
        return;
      }
      if (err.status === 429) setError('Too many attempts. Please wait a minute and try again.');
      else if (err.status === 401 || err.status === 400) setError('Email or password is incorrect.');
      else setError('Something went wrong on our side. Please try again in a moment.');
      return;
    }
    router.push('/dashboard');
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <h1>Sign in</h1>
        {notice === 'reset' ? (
          <Alert tone="success" title="Password updated">
            You can now sign in with your new password.
          </Alert>
        ) : null}
        {notice === 'verified' ? (
          <Alert tone="success" title="Email confirmed">
            Please sign in to continue.
          </Alert>
        ) : null}
        {unverified ? (
          <Alert tone="warning" title="Please confirm your email">
            We&apos;ve sent you a new confirmation link. Check your inbox, then come back to sign in.
          </Alert>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Email address" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" full disabled={pending} aria-disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
        <p>
          <Link href="/forgot-password">Forgotten your password?</Link>
        </p>
        <p>
          New to LunaK9 Club? <Link href="/register">Create an account</Link>
        </p>
      </Stack>
    </form>
  );
}
