import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerRange } from '@/server/services/owner-bookings';
import { isoWeekday } from '@/domain/booking/rules';
import { addDays, formatUkDate, isIsoDate, londonDate } from '@/domain/time';

export const metadata: Metadata = { title: 'Bookings – week' };
export const dynamic = 'force-dynamic';

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const actor = await requirePermission('bookings.manage');
  const sp = await searchParams;
  const base = sp.from && isIsoDate(sp.from) ? sp.from : londonDate(new Date());
  const monday = addDays(base, 1 - isoWeekday(base));
  const days = await ownerRange(getDb(), actor, monday, 7);
  return (
    <Stack>
      <h1>Week of {formatUkDate(monday)}</h1>
      <nav aria-label="Weeks" className={s.row} style={{ justifyContent: 'flex-start' }}>
        <Link href={`/admin/bookings/week?from=${addDays(monday, -7)}`}>‹ Previous week</Link>
        <Link href={`/admin/bookings/week?from=${addDays(monday, 7)}`}>Next week ›</Link>
        <Link href={`/admin/bookings?date=${monday}`}>Day view</Link>
      </nav>
      <Card>
        <div className={s.tableWrap} role="region" aria-label="Week summary" tabIndex={0}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Morning</th>
                <th scope="col">Afternoon</th>
                <th scope="col">Taxi</th>
                <th scope="col">Waitlist</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date}>
                  <td>
                    <Link href={`/admin/bookings?date=${d.date}`}>{formatUkDate(d.date)}</Link>
                  </td>
                  {d.open ? (
                    <>
                      <td>
                        {d.used.am} / {d.cap.session}
                      </td>
                      <td>
                        {d.used.pm} / {d.cap.session}
                      </td>
                      <td>
                        {d.used.taxi} / {d.cap.taxi}
                      </td>
                      <td>{d.waitlist}</td>
                    </>
                  ) : (
                    <td colSpan={4}>
                      <StatusBadge tone="info">Closed{d.closedReason ? `: ${d.closedReason}` : ''}</StatusBadge>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Stack>
  );
}
