'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/infra/auth/client';
import { DEFAULT_AFTER_SIGN_IN, safeCallbackPath } from '@/domain/auth/callback-url';
import { Alert, Field, Stack, buttonClass } from '@/ui/components';
import { PendingButton } from '@/ui/form';
import { MagicLinkForm } from './magic-link-form';

type Notice = 'reset' | 'verified' | 'welcome';

/**
 * Sign-in leads with an emailed link; "Sign in with a password instead" shows the password form (the
 * Owner and staff always use it: links are customers-only). Both keep the callbackUrl. After a password
 * reset or account setup we open on the password form, since that's what the notice asks for.
 */
export function SignInForm({
  notice,
  callbackUrl,
  linkError = false,
}: {
  notice?: Notice;
  callbackUrl?: string;
  linkError?: boolean;
}) {
  const next = safeCallbackPath(callbackUrl);
  const [mode, setMode] = useState<'link' | 'password'>(
    notice === 'reset' || notice === 'welcome' ? 'password' : 'link',
  );
  const [email, setEmail] = useState('');
  const [switched, setSwitched] = useState(false);
  const toggle = (to: 'link' | 'password') => {
    setSwitched(true);
    setMode(to);
  };

  return (
    <div>
      {mode === 'link' ? (
        <MagicLinkForm callbackUrl={next} email={email} onEmailChange={setEmail} linkError={linkError} />
      ) : (
        <PasswordForm notice={notice} next={next} email={email} onEmailChange={setEmail} focusOnMount={switched} />
      )}
      <Stack>
        <p>
          <button
            type="button"
            className={buttonClass('ghost', true)}
            onClick={() => toggle(mode === 'link' ? 'password' : 'link')}
          >
            {mode === 'link' ? 'Sign in with a password instead' : 'Email me a sign-in link instead'}
          </button>
        </p>
        <p>
          New to Luna’s K9 Club? <Link href="/register">Create an account</Link>
        </p>
      </Stack>
    </div>
  );
}

function PasswordForm({
  notice,
  next,
  email,
  onEmailChange,
  focusOnMount,
}: {
  notice?: Notice;
  next: string;
  email: string;
  onEmailChange: (email: string) => void;
  focusOnMount: boolean;
}) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  // After the toggle, focus the new form's heading so the switch is announced.
  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);
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
        <h1 ref={heading} tabIndex={-1}>
          Sign in with your password
        </h1>
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
        <Field
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
        />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <PendingButton full pending={pending} pendingText="Signing in…">
          Sign in
        </PendingButton>
        <p>
          <Link href="/forgot-password">Forgotten your password?</Link>
        </p>
      </Stack>
    </form>
  );
}
