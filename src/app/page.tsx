import Link from 'next/link';
import s from '@/ui/ui.module.css';
import p from '@/ui/public.module.css';
import { buttonClass, PlaceholderMedia } from '@/ui/components';
import { getActor } from '@/server/session';
import { authorize } from '@/server/policy/authorize';
import { getDb } from '@/infra/db/client';
import { publicCancellationHours } from '@/server/services/public-info';

/** Owner-approved wording (D108, variant 2). No trial price in this block. */
const FIRST_DAY_STEPS = [
  { title: 'Say hello', text: 'A relaxed meet-and-greet, no rush.' },
  {
    title: 'A trial day',
    text: 'Your dog spends a day with us so we can see how they get on. It’s one trial day per dog.',
  },
  {
    title: 'Tell us about your dog',
    text: 'Health, feeding and contact details, plus up-to-date vaccination certificates.',
  },
  { title: 'Request your days', text: 'We approve each request, then you pay to secure it.' },
];

/** Owner-approved checklist (D108); kennel cough may be shown publicly. No titre certificates (D73). */
const VACCINATIONS = [
  'A vaccination certificate from your vet showing your dog is protected against distemper, hepatitis and parvovirus (the core vaccines).',
  'Leptospirosis vaccination up to date.',
  'Kennel cough vaccination up to date.',
  'The date each vaccination was given and when it runs out, from the certificate.',
  'If it’s your dog’s first course of vaccinations, we can only take your dog 14 days after the course finishes.',
];

export default async function HomePage() {
  // One set of calls to action: sign up / sign in for visitors, the dashboard and booking for signed-in users.
  const actor = await getActor();
  const signedIn = actor.kind !== 'anonymous';
  const canBook = signedIn && authorize(actor, 'account.access').allowed;
  const hours = await publicCancellationHours(getDb(), actor);
  const isOwner = signedIn && authorize(actor, 'admin.access').allowed;
  return (
    <>
      <section className={p.hero} aria-labelledby="hero-title">
        <div className={p.heroInner}>
          <div className={p.heroText}>
            <p className={p.eyebrow}>Doggie day care · Central Bedfordshire</p>
            <h1 id="hero-title">A luxury retreat for country dogs</h1>
            <p className={p.lead}>
              Book day care, keep your dog&apos;s details up to date and pay invoices in one place.
            </p>
            <div className={p.heroActions}>
              {signedIn ? (
                <>
                  <Link href="/dashboard" className={buttonClass('cta')}>
                    Go to your dashboard
                  </Link>
                  {canBook ? (
                    <Link href="/account/book" className={`${buttonClass('secondary')} ${p.onDark}`}>
                      Book day care
                    </Link>
                  ) : null}
                </>
              ) : (
                <>
                  <Link href="/register" className={buttonClass('cta')}>
                    Create an account
                  </Link>
                  <Link href="/sign-in" className={`${buttonClass('secondary')} ${p.onDark}`}>
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
          <div className={p.heroMedia}>
            {/* PLACEHOLDER: replace with Stephen's photo when supplied. */}
            <PlaceholderMedia ratio="4 / 3" />
          </div>
        </div>
      </section>
      <section className={`${s.container} ${p.searchWrap}`} aria-labelledby="search-title">
        <div className={p.searchCard}>
          <h2 id="search-title" className="visually-hidden">
            Request a day
          </h2>
          <ol className={p.searchSteps}>
            <li>
              <span className={p.searchLabel}>Pick days</span>
              <span className={s.muted}>Any weekday</span>
            </li>
            <li>
              <span className={p.searchLabel}>Dog</span>
              <span className={s.muted}>Your dog</span>
            </li>
            <li>
              <span className={p.searchLabel}>Request</span>
              <span className={s.muted}>We approve, then you pay</span>
            </li>
          </ol>
          <Link
            href={canBook ? '/account/book' : signedIn ? '/dashboard' : '/register'}
            className={buttonClass('primary')}
          >
            Request a day
          </Link>
          <p className={s.hint}>
            No payment until Luna’s K9 Club approves. You can withdraw a request any time. Once booked, cancel free at
            least {hours} hours before; after that the day is charged.
          </p>
        </div>
      </section>
      <section className={`${s.container} ${p.section}`} aria-labelledby="first-day">
        <h2 id="first-day">How your first day works</h2>
        <ol className={p.stepList}>
          {FIRST_DAY_STEPS.map((st, i) => (
            <li key={st.title} className={s.card}>
              <span className={p.stepNumber} aria-hidden="true">
                {i + 1}
              </span>
              <h3>
                <span className="visually-hidden">Step {i + 1}: </span>
                {st.title}
              </h3>
              <p className={s.muted}>{st.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className={`${s.container} ${p.section}`} aria-labelledby="vaccinations">
        <h2 id="vaccinations">Vaccinations we ask for</h2>
        <div className={s.card}>
          <p>Before your dog can start, we need:</p>
          <ul>
            {VACCINATIONS.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
          <p className={s.muted}>
            We check these when you book and on the day. If a vaccination runs out, we can’t take your dog until a new
            certificate is accepted.
          </p>
        </div>
      </section>
      {isOwner ? (
        <section className={`${s.container} ${p.section}`} aria-labelledby="trust-owner">
          {/* Trust facts are NOT supplied by the Owner, so none are published (Stephen, 4 Nov). This block is
              visible only to the signed-in Owner as a reminder; customers and visitors never see it. */}
          <div className={s.card}>
            <h2 id="trust-owner">Trust block: Owner to confirm</h2>
            <p className={s.muted}>
              Only you can see this. Nothing below is on the public site until you provide it: licence reference,
              company number, address, insurance, pet first aid and real photos (with consent from owners and anyone
              shown).
            </p>
          </div>
        </section>
      ) : null}
    </>
  );
}
