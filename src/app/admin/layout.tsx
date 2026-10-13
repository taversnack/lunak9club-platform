import { AppShell, type NavGroup } from '@/ui/app-shell';
import { requirePermission } from '@/server/session';

export const dynamic = 'force-dynamic';

const groups: NavGroup[] = [
  { label: 'Today', items: [{ href: '/admin', label: 'Dashboard' }] },
  {
    label: 'Bookings',
    items: [
      { href: '/admin/bookings', label: 'Bookings' },
      { href: '/admin/memberships', label: 'Memberships' },
    ],
  },
  {
    label: 'Customers',
    items: [
      { href: '/admin/customers', label: 'Customers' },
      { href: '/admin/reviews', label: 'Reviews' },
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
      { href: '/admin/settings/availability', label: 'Opening hours & capacity' },
      { href: '/admin/settings/pricing', label: 'Prices' },
      { href: '/admin/settings/requirements', label: 'Vaccination & onboarding rules' },
      { href: '/admin/settings/terms', label: 'Terms' },
      { href: '/admin/settings/business', label: 'Business details' },
      { href: '/admin/data-requests', label: 'Data requests' },
    ],
  },
];

// Defence in depth: the layout checks access, and every admin page, action and query checks again.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePermission('admin.access');
  return (
    <AppShell
      root="/admin"
      navLabel="Owner"
      userName={actor.name}
      cta={{ href: '/admin/bookings', label: 'Today’s bookings' }}
      groups={groups}
      sidebar
    >
      {children}
    </AppShell>
  );
}
