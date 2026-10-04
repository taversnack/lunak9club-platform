import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack } from '@/ui/components';
import { ActionForm, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { loadBusinessSettings, missingBusinessDetails } from '@/server/services/billing';
import { formatDocumentNumber } from '@/domain/billing/rules';
import { updateBusinessSettingsAction } from '../../actions';

export const metadata: Metadata = { title: 'Business details' };
export const dynamic = 'force-dynamic';

export default async function BusinessSettingsPage() {
  await requirePermission('settings.manage');
  const bs = await loadBusinessSettings(getDb());
  const missing = missingBusinessDetails(bs);
  return (
    <Stack>
      <h1>Business details</h1>
      {missing.length ? (
        <Alert tone="warning" title="Needed before invoices can be sent">
          UK law requires your registered company name, company number and registered office address on invoices.
          Missing: {missing.join(', ')}.
        </Alert>
      ) : null}
      <Card>
        <ActionForm action={updateBusinessSettingsAction}>
          <h2>Printed on invoices</h2>
          <TextField name="tradingName" label="Trading name" defaultValue={bs.tradingName} required />
          <TextField name="legalName" label="Registered company name" defaultValue={bs.legalName} required />
          <TextField
            name="companyNumber"
            label="Company number"
            hint="From Companies House, like 12345678"
            defaultValue={bs.companyNumber}
          />
          <TextArea name="registeredOffice" label="Registered office address" defaultValue={bs.registeredOffice} />
          <TextField name="contactEmail" label="Contact email" type="email" defaultValue={bs.contactEmail} />
          <TextField name="contactPhone" label="Contact phone" type="tel" defaultValue={bs.contactPhone} />
          <p className={s.hint}>Not registered for VAT: invoices say so and show no VAT.</p>
          <h2>Invoice numbers and timing</h2>
          <TextField
            name="invoicePrefix"
            label="Invoice number prefix"
            hint={`Invoices look like ${formatDocumentNumber(bs.invoicePrefix, 1)}, ${formatDocumentNumber(bs.invoicePrefix, 2)}… Credit notes like ${formatDocumentNumber(`${bs.invoicePrefix}CN-`, 1)}. Can only change before the first invoice is sent.`}
            defaultValue={bs.invoicePrefix}
            required
          />
          <div className={s.two}>
            <TextField
              name="draftDay"
              label="Drafts ready on day"
              type="number"
              min="1"
              max="28"
              defaultValue={bs.draftDay}
              required
            />
            <TextField
              name="sendDay"
              label="Send on day"
              type="number"
              min="1"
              max="28"
              defaultValue={bs.sendDay}
              required
            />
          </div>
          <div className={s.two}>
            <TextField name="sendTime" label="Send at (24-hour)" defaultValue={bs.sendTime} required />
            <TextField
              name="paymentTermsDays"
              label="Days to pay"
              type="number"
              min="0"
              max="60"
              defaultValue={bs.paymentTermsDays}
              required
            />
          </div>
          <div className={s.two}>
            <TextField
              name="reminderAfterDays"
              label="Reminder on day"
              type="number"
              min="1"
              max="60"
              defaultValue={bs.reminderAfterDays}
              required
            />
            <TextField name="reminderTime" label="Reminder at (24-hour)" defaultValue={bs.reminderTime} required />
          </div>
          <div>
            <SubmitButton>Save business details</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </Stack>
  );
}
