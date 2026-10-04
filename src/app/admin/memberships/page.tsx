import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Muted, Stack } from '@/ui/components';
import { ActionForm, SubmitButton, TextArea, TextField } from '@/ui/form';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { describeWeekdays, HORIZON_DAYS, ownerMemberships } from '@/server/services/memberships';
import { SESSION_LABELS, type Session } from '@/domain/booking/rules';
import { formatUkDate } from '@/domain/time';
import { approveMembershipAction, bookAheadAction, declineMembershipAction, endMembershipAction } from '../actions';

export const metadata: Metadata = { title: 'Memberships' };
export const dynamic = 'force-dynamic';

export default async function OwnerMembershipsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const actor = await requirePermission('memberships.manage');
  const { requests, active } = await ownerMemberships(getDb(), actor);
  const describe = (m: { weekdays: number[]; session: string; taxi: boolean }) =>
    `${describeWeekdays(m.weekdays)} · ${SESSION_LABELS[m.session as Session]}${m.taxi ? ' · taxi' : ''} · ${m.weekdays.length} day${m.weekdays.length === 1 ? '' : 's'} a week`;
  return (
    <Stack>
      <h1>Memberships</h1>
      {sp.approved !== undefined ? (
        <Alert tone="success">
          Approved. {sp.approved} days booked
          {Number(sp.waitlisted) ? `, ${sp.waitlisted} waitlisted because the day is full` : ''}
          {Number(sp.blocked) ? `, ${sp.blocked} not booked (vaccination or approval)` : ''}. The customer has been
          emailed.
        </Alert>
      ) : null}
      {sp.declined ? <Alert tone="info">Request declined. The customer can see your reason.</Alert> : null}
      <Card aria-labelledby="requests">
        <h2 id="requests">Requests ({requests.length})</h2>
        {requests.length === 0 ? <Muted>No requests waiting.</Muted> : null}
        <ul className={s.list}>
          {requests.map(({ m, dogName, customerName, customerId }) => (
            <li key={m.id} className={s.listItem} style={{ display: 'block' }}>
              <p>
                <strong>{dogName}</strong> (<Link href={`/admin/customers/${customerId}`}>{customerName}</Link>) ·{' '}
                {describe(m)}
                <br />
                <span className={s.hint}>
                  {m.replacesId ? 'Change of days from ' : 'Starts '}
                  {formatUkDate(m.startsOn)}
                </span>
              </p>
              <div className={s.two}>
                <ActionForm action={approveMembershipAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="version" value={m.version} />
                  <SubmitButton>
                    Approve <span className="visually-hidden">{dogName}</span>
                  </SubmitButton>
                </ActionForm>
                <ActionForm action={declineMembershipAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="version" value={m.version} />
                  <TextArea name="reason" label="Reason for declining (the customer sees this)" rows={2} required />
                  <div>
                    <SubmitButton variant="secondary">
                      Decline <span className="visually-hidden">{dogName}</span>
                    </SubmitButton>
                  </div>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card aria-labelledby="active">
        <div className={s.row}>
          <h2 id="active">Active ({active.length})</h2>
          <ActionForm action={bookAheadAction}>
            <SubmitButton variant="secondary" pendingText="Booking…">
              Book membership days ahead ({HORIZON_DAYS} days)
            </SubmitButton>
          </ActionForm>
        </div>
        {active.length === 0 ? <Muted>No active memberships.</Muted> : null}
        <ul className={s.list}>
          {active.map(({ m, dogName, customerName, customerId }) => (
            <li key={m.id} className={s.listItem} style={{ display: 'block' }}>
              <p>
                <strong>{dogName}</strong> (<Link href={`/admin/customers/${customerId}`}>{customerName}</Link>) ·{' '}
                {describe(m)}
                <br />
                <span className={s.hint}>
                  From {formatUkDate(m.startsOn)}
                  {m.endsOn ? ` to ${formatUkDate(m.endsOn)}` : ''}
                </span>
              </p>
              <details>
                <summary>End this membership</summary>
                <ActionForm action={endMembershipAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="version" value={m.version} />
                  <TextField name="endsOn" label="Last day" type="date" required />
                  <div>
                    <SubmitButton variant="danger">
                      End membership <span className="visually-hidden">{dogName}</span>
                    </SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </Stack>
  );
}
