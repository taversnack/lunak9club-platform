'use client';
import { useEffect, useRef, useState } from 'react';
import { requestMagicLink } from '@/infra/auth/client';
import { Alert, Field, Stack, buttonClass } from '@/ui/components';
import { PendingButton } from '@/ui/form';

/** The same reply for every address, known or not, so the form never reveals who has an account. */
export const LINK_SENT_COPY = 'If that address has an account, a link is on its way.';
export const LINK_FAILED_COPY = 'That link has expired or was already used. Request a new one.';
const RATE_LIMITED_COPY = 'Too many requests. Please wait a minute and try again.';
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email-link sign-in: one email field, then a "Check your email" state with resend. `linkError` is set
 * when a used or expired link sent the visitor back here (?error=… from the verify endpoint).
 */
export function MagicLinkForm({
  callbackUrl,
  email,
  onEmailChange,
  linkError,
}: {
  callbackUrl: string;
  email: string;
  onEmailChange: (email: string) => void;
  linkError: boolean;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const sentHeading = useRef<HTMLHeadingElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);

  // Move focus to whatever just changed, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (sentTo) sentHeading.current?.focus();
  }, [sentTo]);
  useEffect(() => {
    if (linkError) errorBox.current?.focus();
  }, [linkError]);

  async function send(address: string): Promise<boolean> {
    setError(null);
    setPending(true);
    const { error: err } = await requestMagicLink(address, callbackUrl);
    setPending(false);
    if (!err) return true;
    setError(
      err.status === 429 ? RATE_LIMITED_COPY : 'Something went wrong on our side. Please try again in a moment.',
    );
    return false;
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim();
    if (!LOOKS_LIKE_EMAIL.test(address)) {
      setFieldError('Enter an email address, like name@example.com');
      return;
    }
    setFieldError(undefined);
    setResent(false);
    if (await send(address)) setSentTo(address);
  }

  async function onResend() {
    if (!sentTo) return;
    setResent(false);
    if (await send(sentTo)) setResent(true);
  }

  if (sentTo) {
    return (
      <Stack>
        <h1 ref={sentHeading} tabIndex={-1}>
          Check your email
        </h1>
        <div aria-live="polite">
          <Alert tone="success">
            {LINK_SENT_COPY} We sent it to <strong>{sentTo}</strong>. It works once and expires after 10 minutes.
          </Alert>
        </div>
        <div aria-live="polite">
          {resent ? <p>We&apos;ve sent another link. Use the newest one.</p> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onResend();
          }}
        >
          <PendingButton full variant="secondary" pending={pending} pendingText="Sending…">
            Send the link again
          </PendingButton>
        </form>
        <p>
          <button
            type="button"
            className={buttonClass('ghost', true)}
            onClick={() => {
              setSentTo(null);
              setResent(false);
              setError(null);
            }}
          >
            Use a different email address
          </button>
        </p>
      </Stack>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <h1>Sign in</h1>
        {linkError ? (
          <div ref={errorBox} tabIndex={-1}>
            <Alert tone="danger">{LINK_FAILED_COPY}</Alert>
          </div>
        ) : null}
        <div aria-live="polite">{error ? <Alert tone="danger">{error}</Alert> : null}</div>
        <p>We&apos;ll email you a link that signs you straight in. No password needed.</p>
        <Field
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          error={fieldError}
        />
        <PendingButton full pending={pending} pendingText="Sending…">
          Email me a sign-in link
        </PendingButton>
      </Stack>
    </form>
  );
}
