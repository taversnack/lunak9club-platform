import type { Metadata } from 'next';
import { Alert, Stack } from '@/ui/components';
import { ActionForm, SubmitButton, TextField } from '@/ui/form';
import { getDb } from '@/infra/db/client';
import { checkInvite } from '@/server/services/membership-workflow';
import { finishSignupAction } from './actions';

export const metadata: Metadata = { title: 'Finish setting up your account' };
export const dynamic = 'force-dynamic';

export default async function FinishSignupPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const invite = token ? await checkInvite(getDb(), token) : null;
  if (!token || !invite) {
    return (
      <Stack>
        <h1>Link not valid</h1>
        <Alert tone="warning">
          This link has expired or has already been used. Please ask Luna’s K9 Club to send you a new one.
        </Alert>
      </Stack>
    );
  }
  return (
    <Stack>
      <h1>Finish setting up your account</h1>
      <p>
        Hi {invite.firstName}, choose a password for {invite.email}. Then sign in to add your dog, check your days and
        finish setting up.
      </p>
      <ActionForm action={finishSignupAction}>
        <input type="hidden" name="token" value={token} />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters"
          required
        />
        <TextField name="confirm" label="Confirm password" type="password" autoComplete="new-password" required />
        <div>
          <SubmitButton pendingText="Saving…">Save password</SubmitButton>
        </div>
      </ActionForm>
    </Stack>
  );
}
