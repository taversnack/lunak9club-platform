import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { buttonClass, Card, Stack } from '@/ui/components';

export default function HomePage() {
  return (
    <>
      <section className={s.hero} aria-labelledby="hero-title">
        <h1 id="hero-title">A luxury retreat for country dogs</h1>
        <p>Doggie day care in Central Bedfordshire.</p>
      </section>
      <div className={`${s.container} ${s.narrow}`}>
        <Card>
          <Stack>
            <h2>Welcome to Luna’s K9 Club</h2>
            <p>Book day care, keep your dog&apos;s details up to date and pay invoices in one place.</p>
            <Link href="/sign-in" className={buttonClass('primary', true)}>
              Sign in
            </Link>
            <Link href="/register" className={buttonClass('secondary', true)}>
              Create an account
            </Link>
          </Stack>
        </Card>
      </div>
    </>
  );
}
