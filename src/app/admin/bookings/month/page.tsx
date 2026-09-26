import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { ownerRange } from '@/server/services/owner-bookings';
import { isoWeekday } from '@/domain/booking/rules';
import { addDays, daysBetween, londonDate } from '@/domain/time';

export const metadata: Metadata = { title: 'Bookings – month' };
export const dynamic = 'force-dynamic';

export default async function MonthPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requirePermission('bookings.manage');
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : londonDate(new Date()).slice(0, 7);
  const first = `${month}-01`;
  const next = addDays(`${month}-28`, 4).slice(0, 7) + '-01';
  const days = (await ownerRange(getDb(), actor, first, daysBetween(first, next))).filter(
    (d) => isoWeekday(d.date) <= 5,
  );
  const title = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(`${first}T12:00:00Z`),
  );
  const prev = addDays(first, -1).slice(0, 7);
  return (
    <Stack>
      <h1>{title}</h1>
      <nav aria-label="Months" className={s.row} style={{ justifyContent: 'flex-start' }}>
        <Link href={`/admin/bookings/month?month=${prev}`}>‹ Previous month</Link>
        <Link href={`/admin/bookings/month?month=${next.slice(0, 7)}`}>Next month ›</Link>
      </nav>
      <Card>
        <div className={s.week}>
          {days.map((d) => (
            <Link
              key={d.date}
              href={`/admin/bookings?date=${d.date}`}
              className={`${s.day} ${d.open ? '' : s.dayClosed}`}
            >
              <strong>
                {new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(
                  new Date(`${d.date}T12:00:00Z`),
                )}
              </strong>
              {d.open ? (
                <span>
                  {Math.max(d.used.am, d.used.pm)} / {d.cap.session} dogs
                  {d.waitlist ? ` · ${d.waitlist} waiting` : ''}
                </span>
              ) : (
                <span className={s.hint}>Closed{d.closedReason ? `: ${d.closedReason}` : ''}</span>
              )}
            </Link>
          ))}
        </div>
      </Card>
    </Stack>
  );
}
