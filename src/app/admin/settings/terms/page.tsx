import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack } from '@/ui/components';
import { ActionForm, Checkbox, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { currentTerms } from '@/server/services/policies';
import { getDb } from '@/infra/db/client';
import { formatDateTimeLondon } from '@/ui/format';
import { publishTermsAction } from '../../actions';

export const metadata: Metadata = { title: 'Terms and conditions' };
export const dynamic = 'force-dynamic';

export default async function TermsAdminPage() {
  await requirePermission('policies.manage');
  const terms = await currentTerms(getDb());
  return (
    <Stack>
      <h1>Terms and conditions</h1>
      <Alert tone="warning" title="Get these checked">
        Please have your terms reviewed by a solicitor before launch, especially cancellation charges and emergency vet
        treatment.
      </Alert>
      {terms ? (
        <Card aria-labelledby="current">
          <h2 id="current">
            Current: version {terms.version} – {terms.title}
          </h2>
          <p className={s.hint}>Published {formatDateTimeLondon(terms.publishedAt)}</p>
          <div className={s.pre}>{terms.body}</div>
        </Card>
      ) : null}
      <Card aria-labelledby="publish">
        <h2 id="publish">Publish a new version</h2>
        <ActionForm action={publishTermsAction}>
          <TextField name="title" label="Title" required defaultValue={terms?.title.replace(' (placeholder)', '')} />
          <TextArea name="body" label="Terms" rows={14} required defaultValue={terms?.body} />
          <Checkbox
            name="confirm"
            label="I understand every customer will need to accept the new version before booking"
          />
          <div>
            <SubmitButton>Publish new version</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </Stack>
  );
}
