import { NavLink } from '@/ui/nav-link';
import s from '@/ui/ui.module.css';
import { SignOutButton } from '@/ui/sign-out-button';
import { requirePermission } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('account.access');
  return (
    <div className={s.container}>
      <nav aria-label="Your account" className={s.subnav}>
        <NavLink href="/account">Overview</NavLink>
        <NavLink href="/account/book">Book</NavLink>
        <NavLink href="/account/bookings">Bookings</NavLink>
        <NavLink href="/account/requests">Requests</NavLink>
        <NavLink href="/account/membership">Membership</NavLink>
        <NavLink href="/account/invoices">Invoices</NavLink>
        <NavLink href="/account/dogs/new">Add a dog</NavLink>
        <NavLink href="/account/profile">Your details</NavLink>
        <NavLink href="/account/contacts">Contacts</NavLink>
        <NavLink href="/account/terms">Terms</NavLink>
        <NavLink href="/account/data">Your data</NavLink>
        <SignOutButton />
      </nav>
      {children}
    </div>
  );
}
