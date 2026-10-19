import { NavLink } from '@/ui/nav-link';
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
        <NavLink href="/admin">Dashboard</NavLink>
        <NavLink href="/admin/bookings">Bookings</NavLink>
        <NavLink href="/admin/approvals">Requests</NavLink>
        <NavLink href="/admin/memberships">Memberships</NavLink>
        <NavLink href="/admin/invoices">Invoices</NavLink>
        <NavLink href="/admin/refunds">Refunds</NavLink>
        <NavLink href="/admin/reviews">Reviews</NavLink>
        <NavLink href="/admin/incidents">Incidents</NavLink>
        <NavLink href="/admin/customers">Customers</NavLink>
        <NavLink href="/admin/settings/availability">Opening</NavLink>
        <NavLink href="/admin/settings/pricing">Prices</NavLink>
        <NavLink href="/admin/settings/requirements">Requirements</NavLink>
        <NavLink href="/admin/settings/terms">Terms</NavLink>
        <NavLink href="/admin/settings/business">Business</NavLink>
        <NavLink href="/admin/data-requests">Data requests</NavLink>
        <SignOutButton />
      </nav>
      {children}
    </div>
  );
}
