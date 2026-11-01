import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Alert, Card, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { bookingCalendar, myBookableDogs } from '@/server/services/bookings';
import { isoWeekday } from '@/domain/booking/rules';
import { REQUEST_NOT_SECURED } from '@/domain/booking/wording';
import { bookPageState, dogCantBookReasons, nothingToBookReasons } from '@/domain/booking/book-page';

export const metadata: Metadata = { title: 'Book day care' };
export const dynamic = 'force-dynamic';

const AVAIL = {
  available: { tone: 'success' as const, text: 'Available' },
  // Customers never see how many places are left, so "nearly full" reads as plain "Available" (D100).
  nearly_full: { tone: 'success' as const, text: 'Available' },
  full: { tone: 'danger' as const, text: 'Full – join the waitlist' },
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
  const state = bookPageState(dogs);
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
      <p className={s.hint}>
        Members: extra days are booked here and charged at your membership day rate.{' '}
        <Link href="/account/faq#faq-extra">How extra days work</Link>
      </p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Alert tone="info" title="How booking works" live={false}>
        <p data-testid="book-request-not-secured">{REQUEST_NOT_SECURED}</p>
      </Alert>
      {state !== 'form' ? (
        state === 'no-dogs' ? (
          <Alert tone="info" title="Add your dog to start booking">
            You haven’t added a dog yet. <Link href="/account/dogs/new">Add a dog</Link> and we’ll take you through the
            rest.
          </Alert>
        ) : (
          <Alert tone="info" title="Nothing to book yet">
            <ul data-testid="book-nothing-reasons">
              {nothingToBookReasons(dogs).map((r) => (
                <li key={r.name}>
                  {r.name}: {r.reasons[0]}
                  {r.reasons.slice(1).map((x) => (
                    <span key={x} className={s.hintLine}>
                      {x}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            <p>
              <Link href="/account">See what’s left to do</Link>.
            </p>
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
                        <span className={s.hint} data-testid="dog-hint">
                          {' – '}
                          {dogCantBookReasons(d).map((x, n) =>
                            n === 0 ? (
                              <span key={x}>{x}</span>
                            ) : (
                              <span key={x} className={s.hintLine}>
                                {x}
                              </span>
                            ),
                          )}
                        </span>
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
            <Card aria-labelledby="what">
              <Stack>
                <p>
                  Full day, {cal.settings.fullDayStart}–{cal.settings.fullDayEnd}.
                </p>
                <input type="hidden" name="session" value="full" />
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
                          {d.open ? null : <span className={s.hint}>{d.closedReason}</span>}
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
