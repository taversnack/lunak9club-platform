import type { Metadata } from 'next';
import s from '@/ui/ui.module.css';
import { Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { ActionForm, Checkbox, SubmitButton, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { listMyContacts } from '@/server/services/customers';
import { addContactAction, removeContactAction } from '../actions';

export const metadata: Metadata = { title: 'Contacts' };
export const dynamic = 'force-dynamic';

export default async function ContactsPage() {
  const actor = await requirePermission('account.access');
  const contacts = await listMyContacts(getDb(), actor);
  return (
    <Stack>
      <h1>Contacts</h1>
      <Card aria-labelledby="yours">
        <h2 id="yours">Your contacts</h2>
        {contacts.length === 0 ? (
          <Muted>No contacts yet. We need at least one emergency contact before your dog can be approved.</Muted>
        ) : (
          <ul className={s.list}>
            {contacts.map((c) => (
              <li key={c.id} className={s.listItem}>
                <div>
                  <strong>{c.name}</strong>
                  {c.relationship ? <span className={s.muted}> – {c.relationship}</span> : null}
                  <div>{c.phone}</div>
                  <div className={s.row} style={{ justifyContent: 'flex-start', marginTop: 4 }}>
                    {c.isEmergencyContact ? <StatusBadge tone="info">Emergency contact</StatusBadge> : null}
                    {c.isAuthorisedCollector ? <StatusBadge tone="info">Can collect</StatusBadge> : null}
                  </div>
                </div>
                <ActionForm action={removeContactAction}>
                  <input type="hidden" name="contactId" value={c.id} />
                  <SubmitButton variant="secondary" pendingText="Removing…">
                    Remove <span className="visually-hidden">{c.name}</span>
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card aria-labelledby="add">
        <h2 id="add">Add a contact</h2>
        <ActionForm action={addContactAction}>
          <TextField name="name" label="Full name" required autoComplete="off" />
          <TextField
            name="relationship"
            label="Relationship to you"
            hint="For example partner, neighbour, dog walker"
          />
          <TextField name="phone" label="Phone number" type="tel" inputMode="tel" required />
          <Checkbox name="isEmergencyContact" label="Emergency contact – we can call them if we can’t reach you" />
          <Checkbox name="isAuthorisedCollector" label="Allowed to collect your dog" />
          <div>
            <SubmitButton>Add contact</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </Stack>
  );
}
