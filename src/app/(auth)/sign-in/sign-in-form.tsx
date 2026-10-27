'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/infra/auth/client';
import { DEFAULT_AFTER_SIGN_IN, safeCallbackPath } from '@/domain/auth/callback-url';
import { Alert, Field, Stack } from '@/ui/components';
import { PendingButton } from '@/ui/form';

export function SignInForm({
  notice,
  callbackUrl,
}: {
  notice?: 'reset' | 'verified' | 'welcome';
  callbackUrl?: string;
}) {
  const router = useRouter();
  const next = safeCallbackPath(callbackUrl);
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
      // Also used by the confirmation email sent when the address isn't verified yet (sendOnSignIn),
      // so the link in it signs the customer in and brings them back here too.
      callbackURL: next,
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
    if (next === DEFAULT_AFTER_SIGN_IN) router.push(DEFAULT_AFTER_SIGN_IN);
    // A full page load: the target may be a route handler (a pay link) that redirects to the card page.
    else window.location.assign(next);
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
        {notice === 'welcome' ? (
          <Alert tone="success" title="Your account is ready">
            Sign in with your email address and new password to finish setting up.
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
        <PendingButton full pending={pending} pendingText="Signing in…">
          Sign in
        </PendingButton>
        <p>
          <Link href="/forgot-password">Forgotten your password?</Link>
        </p>
        <p>
          New to Luna’s K9 Club? <Link href="/register">Create an account</Link>
        </p>
      </Stack>
    </form>
  );
}
