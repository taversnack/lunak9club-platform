import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { SignOutButton } from '@/ui/sign-out-button';
import { requirePermission } from '@/server/session';

export const dynamic = 'force-dynamic';

// Defence in depth: the layout checks access, and every admin page, action and query checks again.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePermission('admin.access');
  return (
    <div className={s.container}>
      <nav aria-label="Owner" className={s.subnav}>
        <Link href="/admin">Dashboard</Link>
        <Link href="/admin/bookings">Bookings</Link>
        <Link href="/admin/reviews">Reviews</Link>
        <Link href="/admin/customers">Customers</Link>
        <Link href="/admin/settings/availability">Opening</Link>
        <Link href="/admin/settings/requirements">Requirements</Link>
        <Link href="/admin/settings/terms">Terms</Link>
        <SignOutButton />
      </nav>
      {children}
    </div>
  );
}
