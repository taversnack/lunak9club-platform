import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack } from '@/ui/components';
import { ActionForm, Checkbox, SubmitButton } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { myTermsStatus } from '@/server/services/policies';
import { formatDateTimeLondon } from '@/ui/format';
import { acceptTermsAction } from '../actions';

export const metadata: Metadata = { title: 'Terms and conditions' };
export const dynamic = 'force-dynamic';

export default async function TermsPage() {
  const actor = await requirePermission('account.access');
  const { terms, acceptedAt } = await myTermsStatus(getDb(), actor);
  if (!terms) return <Card>No terms have been published yet.</Card>;
  return (
    <Card>
      <Stack>
        <h1>{terms.title}</h1>
        <p className={s.muted}>Version {terms.version}</p>
        <div className={s.pre}>{terms.body}</div>
        {acceptedAt ? (
          <Alert tone="success">You accepted this version on {formatDateTimeLondon(acceptedAt)}.</Alert>
        ) : (
          <ActionForm action={acceptTermsAction}>
            <input type="hidden" name="versionId" value={terms.id} />
            <Checkbox name="agree" label="I have read and accept these terms" />
            <div>
              <SubmitButton>Accept terms</SubmitButton>
            </div>
          </ActionForm>
        )}
      </Stack>
    </Card>
  );
}
