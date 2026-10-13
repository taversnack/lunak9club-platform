import { AppShell, type NavGroup, type NavItem } from '@/ui/app-shell';
import { BookIcon, HomeIcon, InvoiceIcon, ListIcon } from '@/ui/nav-icons';
import { requirePermission } from '@/server/session';

export const dynamic = 'force-dynamic';

const tabs: NavItem[] = [
  { href: '/account', label: 'Overview', icon: <HomeIcon /> },
  { href: '/account/book', label: 'Book', icon: <BookIcon /> },
  { href: '/account/bookings', label: 'Bookings', icon: <ListIcon /> },
  { href: '/account/invoices', label: 'Invoices', icon: <InvoiceIcon /> },
];

const groups: NavGroup[] = [
  { label: 'Day care', items: tabs },
  {
    label: 'Your account',
    items: [
      { href: '/account/membership', label: 'Membership' },
      { href: '/account/dogs/new', label: 'Add a dog' },
      { href: '/account/profile', label: 'Your details' },
      { href: '/account/contacts', label: 'Contacts' },
      { href: '/account/terms', label: 'Terms' },
      { href: '/account/data', label: 'Your data' },
    ],
  },
];

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePermission('account.access');
  return (
    <AppShell
      root="/account"
      navLabel="Your account"
      userName={actor.name}
      cta={{ href: '/account/book', label: 'Book a day' }}
      tabs={tabs}
      groups={groups}
    >
      {children}
    </AppShell>
  );
}
