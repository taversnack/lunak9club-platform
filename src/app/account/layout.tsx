import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { SignOutButton } from '@/ui/sign-out-button';
import { requirePermission } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('account.access');
  return (
    <div className={s.container}>
      <nav aria-label="Your account" className={s.subnav}>
        <Link href="/account">Overview</Link>
        <Link href="/account/book">Book</Link>
        <Link href="/account/bookings">Bookings</Link>
        <Link href="/account/dogs/new">Add a dog</Link>
        <Link href="/account/profile">Your details</Link>
        <Link href="/account/contacts">Contacts</Link>
        <Link href="/account/terms">Terms</Link>
        <SignOutButton />
      </nav>
      {children}
    </div>
  );
}
