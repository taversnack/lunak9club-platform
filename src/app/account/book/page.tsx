import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { bookingCalendar, myBookableDogs } from '@/server/services/bookings';
import { isoWeekday } from '@/domain/booking/rules';

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
  // Group into Monday-start weeks for a readable calendar.
  const weeks: (typeof cal.days)[] = [];
  for (const day of cal.days) {
    if (!weeks.length || isoWeekday(day.date) === 1) weeks.push([]);
    weeks.at(-1)!.push(day);
  }
  const open = (w: typeof cal.days) => w.filter((d) => isoWeekday(d.date) <= 5 || d.open);

  return (
    <Stack>
      <h1>Book day care</h1>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {bookable.length === 0 ? (
        <Alert tone="info" title="Nothing to book yet">
          Your dog needs to be approved before you can book. <Link href="/account">See what’s left to do</Link>.
        </Alert>
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
                      disabled={!d.canBook}
                      defaultChecked={bookable.length === 1 && d.canBook}
                    />
                    <span>
                      {d.name}
                      {!d.canBook ? <span className={s.hint}> – {d.blockers[0]}</span> : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            </Card>
            <Card aria-labelledby="what">
              <Stack>
                <fieldset className={s.fieldset}>
                  <legend className={s.label} id="what">
                    Full day or half day?
                  </legend>
                  <div className={s.choices}>
                    <label className={s.choice}>
                      <input type="radio" name="session" value="full" defaultChecked />
                      <span>
                        Full day ({cal.settings.fullDayStart}–{cal.settings.fullDayEnd})
                      </span>
                    </label>
                    <label className={s.choice}>
                      <input type="radio" name="session" value="am" />
                      <span>
                        Morning ({cal.settings.morningStart}–{cal.settings.morningEnd})
                      </span>
                    </label>
                    <label className={s.choice}>
                      <input type="radio" name="session" value="pm" />
                      <span>
                        Afternoon ({cal.settings.afternoonStart}–{cal.settings.afternoonEnd})
                      </span>
                    </label>
                  </div>
                </fieldset>
                <label className={s.choice}>
                  <input type="checkbox" name="taxi" value="1" />
                  <span>Collect and drop off with the dog taxi (included in the price)</span>
                </label>
                <fieldset className={s.fieldset}>
                  <legend className={s.label}>If a day is full</legend>
                  <div className={s.choices}>
                    <label className={s.choice}>
                      <input type="radio" name="ifFull" value="waitlist" defaultChecked />
                      <span>Add me to the waitlist</span>
                    </label>
                    <label className={s.choice}>
                      <input type="radio" name="ifFull" value="skip" />
                      <span>Don’t book that day</span>
                    </label>
                  </div>
                </fieldset>
              </Stack>
            </Card>
            <Card aria-labelledby="when">
              <fieldset className={s.fieldset}>
                <legend className={s.label} id="when">
                  Choose your dates
                </legend>
                <span className={s.hint}>
                  Bookings close at 23:59 the day before. Weekends and bank holidays are closed.
                </span>
                {weeks.map((w) => (
                  <div key={w[0]!.date} className={s.week}>
                    {open(w).map((d) => {
                      const a = AVAIL[d.availability];
                      return (
                        <label key={d.date} className={`${s.day} ${d.open ? '' : s.dayClosed}`}>
                          <span className={s.dayTop}>
                            <input type="checkbox" name="date" value={d.date} disabled={!d.open} />
                            <strong>{dayLabel(d.date)}</strong>
                          </span>
                          <StatusBadge tone={a.tone}>{a.text}</StatusBadge>
                          {d.open ? (
                            <span className={s.hint}>
                              {d.left.full > 0
                                ? `${d.left.full} full-day places`
                                : `Morning ${Math.max(0, d.left.am)}, afternoon ${Math.max(0, d.left.pm)}`}
                            </span>
                          ) : (
                            <span className={s.hint}>{d.closedReason}</span>
                          )}
                          {d.mine.length ? (
                            <span className={s.hint}>Booked: {d.mine.map((m) => m.dogName).join(', ')}</span>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                ))}
              </fieldset>
            </Card>
            <div>
              <button type="submit" className={`${s.button} ${s.primary}`}>
                Check price and availability
              </button>
            </div>
          </Stack>
        </form>
      )}
    </Stack>
  );
}
