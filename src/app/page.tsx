import Link from 'next/link';
import s from '@/ui/ui.module.css';
import p from '@/ui/public.module.css';
import { buttonClass } from '@/ui/components';
import { getActor } from '@/server/session';
import { authorize } from '@/server/policy/authorize';

const benefits = [
  { title: 'Book in seconds', text: 'Pick your days, see the price straight away and pay securely by card.' },
  { title: 'Everything in one place', text: 'Vaccinations, vet details and emergency contacts, kept up to date.' },
  { title: 'Peace of mind', text: 'Daily welfare checks and clear incident reports, shared with you.' },
];

export default async function HomePage() {
  // One set of calls to action: sign up / sign in for visitors, the dashboard and booking for signed-in users.
  const actor = await getActor();
  const signedIn = actor.kind !== 'anonymous';
  const canBook = signedIn && authorize(actor, 'account.access').allowed;
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
        </div>
      </section>
      <section className={`${s.container} ${p.benefits}`} aria-labelledby="why">
        <h2 id="why">Why owners choose Luna’s K9 Club</h2>
        <ul className={p.benefitList}>
          {benefits.map((b) => (
            <li key={b.title} className={s.card}>
              <h3>{b.title}</h3>
              <p className={s.muted}>{b.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
