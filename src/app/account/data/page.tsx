import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack } from '@/ui/components';
import { ActionForm, SubmitButton, TextArea } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myDataRequests } from '@/server/services/privacy';
import { formatDateTimeLondon } from '@/ui/format';
import { requestErasureAction, withdrawErasureAction } from '../actions';

export const metadata: Metadata = { title: 'Your data' };
export const dynamic = 'force-dynamic';

export default async function YourDataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('account.access');
  const requests = await myDataRequests(getDb(), actor);
  const open = requests.find((r) => r.status === 'requested');
  const declined = requests.find((r) => r.status === 'declined');
  return (
    <Stack>
      <h1>Your data</h1>
      {sp.done === 'requested' ? (
        <Alert tone="success">We’ve received your request and will reply within one month.</Alert>
      ) : null}
      {sp.done === 'withdrawn' ? <Alert tone="info">Your request has been withdrawn.</Alert> : null}
      <Card aria-labelledby="copy">
        <h2 id="copy">Download a copy</h2>
        <p>
          Get everything we hold about you and your dogs – your details, contacts, dogs’ health and behaviour records,
          bookings, invoices, incident reports and shared daily notes – as a file you can keep.
        </p>
        <p>
          <a className={`${s.button} ${s.secondary}`} href="/api/account/export">
            Download my data
          </a>
        </p>
      </Card>
      <Card aria-labelledby="delete">
        <h2 id="delete">Delete your account</h2>
        <p>
          We’ll close your account so you can no longer sign in. The law requires us to keep some records for a while –
          your dogs’ day care register, health and incident records for 3 years after their last visit, and invoices for
          6 years. We remove them automatically after that and don’t use them for anything else.
        </p>
        <p className={s.hint}>
          Any upcoming bookings, membership or unpaid invoices need to be sorted out first – we’ll help with that.
        </p>
        {open ? (
          <>
            <Alert tone="info">
              You asked to delete your account on {formatDateTimeLondon(open.requestedAt)}. We’ll be in touch.
            </Alert>
            <ActionForm action={withdrawErasureAction}>
              <div>
                <SubmitButton variant="secondary">Withdraw my request</SubmitButton>
              </div>
            </ActionForm>
          </>
        ) : (
          <>
            {declined ? (
              <Alert tone="warning" title="Your last request couldn’t be completed">
                {declined.decisionReason}
              </Alert>
            ) : null}
            <ActionForm action={requestErasureAction}>
              <TextArea name="reason" label="Anything you’d like to tell us?" rows={2} />
              <div>
                <SubmitButton variant="danger">Ask to delete my account</SubmitButton>
              </div>
            </ActionForm>
          </>
        )}
      </Card>
    </Stack>
  );
}
