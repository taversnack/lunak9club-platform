import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { buttonClass, Card, Stack } from '@/ui/components';

export default function HomePage() {
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Card>
        <Stack>
          <h1>Welcome to LunaK9 Club</h1>
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
  );
}
