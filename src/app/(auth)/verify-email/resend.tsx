'use client';
import { useState } from 'react';
import { authClient } from '@/infra/auth/client';
import { Alert, Button, Field, Stack } from '@/ui/components';

export function ResendVerification({ defaultEmail }: { defaultEmail: string }) {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get('email') ?? '');
    await authClient.sendVerificationEmail({ email, callbackURL: '/dashboard' });
    setPending(false);
    setSent(true); // same response whatever the outcome, to avoid account enumeration
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack>
        {sent ? (
          <Alert tone="success">
            If that address has an account waiting for confirmation, a new link is on its way.
          </Alert>
        ) : null}
        <Field
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={defaultEmail}
          required
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          Send a new link
        </Button>
      </Stack>
    </form>
  );
}
