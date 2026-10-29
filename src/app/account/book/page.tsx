import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { bookingCalendar, myBookableDogs } from '@/server/services/bookings';
import { isoWeekday } from '@/domain/booking/rules';
import b from './book.module.css';
import { DatePager, StickySubmit } from './date-pager';
import { FocusOnMount } from '@/ui/focus-on-mount';

export const metadata: Metadata = { title: 'Book day care' };
export const dynamic = 'force-dynamic';

const AVAIL = {
  available: { tone: 'success' as const, text: 'Available' },
  nearly_full: { tone: 'warning' as const, text: 'Nearly full' },
  full: { tone: 'danger' as const, text: 'Full – waitlist' },
  closed: { tone: 'info' as const, text: 'Closed' },
};
const dayLabel = (d: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(`${d}T12:00:00Z`),
  );

export default async function BookPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requirePermission('account.access');
  const db = getDb();
  const [dogs, cal] = await Promise.all([myBookableDogs(db, actor), bookingCalendar(db, actor)]);
  const { error } = await searchParams;
  const bookable = dogs.filter((d) => d.canBook);
  const trialable = dogs.filter((d) => d.canRequestTrial);
  // Group into Monday-start weeks for a readable calendar.
  const weeks: (typeof cal.days)[] = [];
  for (const day of cal.days) {
    if (!weeks.length || isoWeekday(day.date) === 1) weeks.push([]);
    weeks.at(-1)!.push(day);
  }
  const open = (w: typeof cal.days) => w.filter((d) => isoWeekday(d.date) <= 5 || d.open);
  // Two weeks per page keeps the page short on phones (all pages stay in the form).
  const pairs: (typeof cal.days)[][] = [];
  for (let n = 0; n < weeks.length; n += 2) pairs.push(weeks.slice(n, n + 2));
  const rangeLabel = (p: (typeof cal.days)[]) => {
    const all = p.flat();
    return `${dayLabel(all[0]!.date)} – ${dayLabel(all.at(-1)!.date)}`;
  };

  return (
    <Stack>
      <h1>Book day care</h1>
      <p className={s.hint}>
        Members: extra days are booked here and charged at your membership day rate.{' '}
        <Link href="/account/faq#faq-extra">How extra days work</Link>
      </p>
      {error ? (
        <FocusOnMount>
          <Alert tone="danger">{error}</Alert>
        </FocusOnMount>
      ) : null}
      {bookable.length === 0 ? (
        dogs.length === 0 ? (
          <Alert tone="info" title="Add your dog to start booking">
            You haven’t added a dog yet. <Link href="/account/dogs/new">Add a dog</Link> and we’ll take you through the
            rest.
          </Alert>
        ) : (
          <Alert tone="info" title="Nothing to book yet">
            Your dog needs to be approved before you can book. <Link href="/account">See what’s left to do</Link>.
          </Alert>
        )
      ) : (
        <form method="get" action="/account/book/review">
          <Stack>
            <Card aria-labelledby="who">
              <fieldset className={s.fieldset}>
                <legend className={s.label} id="who">
                  Which dogs?
                </legend>
                {dogs.map((d) => (
                  <label key={d.id} className={s.choice}>
                    <input
                      type="checkbox"
                      name="dog"
                      value={d.id}
                      disabled={!d.canBook && !d.canRequestTrial}
                      defaultChecked={bookable.length === 1 && d.canBook}
                    />
                    <span>
                      {d.name}
                      {d.canRequestTrial ? (
                        <span className={s.hint}> – not approved yet: you can ask for a trial day</span>
                      ) : !d.canBook ? (
                        <span className={s.hint}> – {d.blockers[0]}</span>
                      ) : null}
                    </span>
                  </label>
                ))}
                {trialable.length ? (
                  <label className={s.choice}>
                    <input type="checkbox" name="trial" value="1" defaultChecked={bookable.length === 0} />
                    <span>This is a trial day request (one dog, one date)</span>
                  </label>
                ) : null}
              </fieldset>
            </Card>
            {/* Full days only (Stephen, Oct 2026); the server ignores anything else from customers. */}
            <input type="hidden" name="session" value="full" />
            <Card aria-labelledby="when">
              <fieldset className={s.fieldset}>
                <legend className={s.label} id="when">
                  Choose your dates
                </legend>
                <span className={s.hint}>
                  Full days, {cal.settings.fullDayStart}–{cal.settings.fullDayEnd}, with the dog taxi included. Bookings
                  close at 23:59 the day before. Weekends and bank holidays are closed.
                </span>
                <DatePager
                  labels={pairs.map(rangeLabel)}
                  pages={pairs.map((p) => (
                    <div key={p[0]![0]!.date} className={b.days}>
                      {p.flatMap(open).map((d) => {
                        const a = AVAIL[d.availability];
                        return (
                          <label key={d.date} className={b.dayCard}>
                            <span className={b.dayTop}>
                              <input type="checkbox" name="date" value={d.date} disabled={!d.open} />
                              <strong>{dayLabel(d.date)}</strong>
                            </span>
                            <StatusBadge tone={a.tone}>{a.text}</StatusBadge>
                            {/* Customers see Available / Nearly full / Full, never the number of places. */}
                            {d.open ? null : <span className={b.left}>{d.closedReason}</span>}
                            {d.mine.length ? (
                              <span className={b.left}>Booked: {d.mine.map((m) => m.dogName).join(', ')}</span>
                            ) : null}
                          </label>
                        );
                      })}
                    </div>
                  ))}
                />
              </fieldset>
            </Card>
            <StickySubmit />
          </Stack>
        </form>
      )}
    </Stack>
  );
}
