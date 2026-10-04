import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { buttonClass, Card, Muted, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerIncidents } from '@/server/services/welfare';
import { formatDateTimeLondon } from '@/ui/format';
import { formatUkDate } from '@/domain/time';
import { INCIDENT_KIND_LABELS, SEVERITY_LABELS, SEVERITY_TONE } from '@/ui/welfare-labels';

export const metadata: Metadata = { title: 'Incidents' };
export const dynamic = 'force-dynamic';

type Row = Awaited<ReturnType<typeof ownerIncidents>>['open'][number];

function IncidentTable({ rows, label }: { rows: Row[]; label: string }) {
  if (!rows.length) return <Muted>None.</Muted>;
  return (
    <div className={s.tableWrap} role="region" aria-label={label} tabIndex={0}>
      <table className={s.table}>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Dog</th>
            <th scope="col">What</th>
            <th scope="col">Severity</th>
            <th scope="col">Customer read it</th>
            <th scope="col">Follow-up</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.inc.id}>
              <td>
                <Link href={`/admin/incidents/${r.inc.id}`}>{formatDateTimeLondon(r.inc.occurredAt)}</Link>
              </td>
              <td>
                {r.dogName} <span className={s.hint}>({r.customerName})</span>
              </td>
              <td>{INCIDENT_KIND_LABELS[r.inc.kind]}</td>
              <td>
                <StatusBadge tone={SEVERITY_TONE[r.inc.severity]!}>{SEVERITY_LABELS[r.inc.severity]}</StatusBadge>
              </td>
              <td>{r.inc.acknowledgedAt ? 'Yes' : 'Not yet'}</td>
              <td>{r.inc.followUpDue ? formatUkDate(r.inc.followUpDue) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function IncidentsPage() {
  const actor = await requirePermission('incidents.manage');
  const { open, followUpsDue, closed } = await ownerIncidents(getDb(), actor);
  return (
    <Stack>
      <div className={s.row}>
        <h1>Incidents</h1>
        <Link href="/admin/incidents/new" className={buttonClass('primary')}>
          Report an incident
        </Link>
      </div>
      <p className={s.hint}>
        Your licence requires injuries, illness and signs of distress to be recorded and the dog’s owner told. Every
        report is shared with the customer and kept for 3 years.
      </p>
      {followUpsDue.length ? (
        <Card aria-labelledby="due">
          <h2 id="due">Follow-ups due ({followUpsDue.length})</h2>
          <IncidentTable rows={followUpsDue} label="Follow-ups due" />
        </Card>
      ) : null}
      <Card aria-labelledby="open">
        <h2 id="open">Open ({open.length})</h2>
        <IncidentTable rows={open} label="Open incidents" />
      </Card>
      <Card aria-labelledby="closed">
        <h2 id="closed">Recently closed</h2>
        <IncidentTable rows={closed} label="Closed incidents" />
      </Card>
    </Stack>
  );
}
