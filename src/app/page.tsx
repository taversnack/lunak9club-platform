import Link from 'next/link';
import s from '@/ui/ui.module.css';
import p from '@/ui/public.module.css';
import { buttonClass, Card, Stack } from '@/ui/components';

const benefits = [
  { title: 'Book in seconds', text: 'Pick your days, see the price straight away and pay securely by card.' },
  { title: 'Everything in one place', text: 'Vaccinations, vet details and emergency contacts, kept up to date.' },
  { title: 'Peace of mind', text: 'Daily welfare checks and clear incident reports, shared with you.' },
];

export default function HomePage() {
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
              <Link href="/register" className={buttonClass('cta')}>
                Create an account
              </Link>
              <Link href="/sign-in" className={`${buttonClass('secondary')} ${p.onDark}`}>
                Sign in
              </Link>
            </div>
          </div>
          <Card as="div">
            <Stack>
              <h2>Welcome back</h2>
              <p className={s.muted}>Sign in to book days, see your bookings and pay invoices.</p>
              <Link href="/sign-in" className={buttonClass('primary', true)}>
                Sign in
              </Link>
              <Link href="/register" className={buttonClass('secondary', true)}>
                Create an account
              </Link>
            </Stack>
          </Card>
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
