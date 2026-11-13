import { AppShell, type NavGroup } from '@/ui/app-shell';
import { requirePermission } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Owner navigation (design plan, Owner back office): sidebar from 1024 px, Menu drawer below. No tab bar. */
const groups: NavGroup[] = [
  {
    label: 'Today',
    items: [
      { href: '/admin', label: 'Today' },
      { href: '/admin/approvals', label: 'Requests' },
      { href: '/admin/reviews', label: 'Reviews' },
    ],
  },
  {
    label: 'Day care',
    items: [
      { href: '/admin/bookings', label: 'Bookings' },
      { href: '/admin/memberships', label: 'Memberships' },
      { href: '/admin/customers', label: 'Customers' },
      { href: '/admin/incidents', label: 'Incidents' },
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/admin/invoices', label: 'Invoices' },
      { href: '/admin/refunds', label: 'Refunds' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/admin/settings/availability', label: 'Opening' },
      { href: '/admin/settings/pricing', label: 'Prices' },
      { href: '/admin/settings/requirements', label: 'Requirements' },
      { href: '/admin/settings/terms', label: 'Terms' },
      { href: '/admin/settings/business', label: 'Business' },
      { href: '/admin/data-requests', label: 'Data requests' },
    ],
  },
];

// Defence in depth: the layout checks access, and every admin page, action and query checks again.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePermission('admin.access');
  return (
    <AppShell root="/admin" navLabel="Owner" userName={actor.name} groups={groups} sidebar>
      {children}
    </AppShell>
  );
}
