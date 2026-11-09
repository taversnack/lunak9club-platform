import { AppShell, type NavGroup, type NavItem } from '@/ui/app-shell';
import { BookIcon, ListIcon, PawIcon, PersonIcon } from '@/ui/nav-icons';
import { requirePermission } from '@/server/session';

export const dynamic = 'force-dynamic';

/** Phone bottom tab bar and desktop header links (design plan): Book, Bookings, Dogs, Account. */
const tabs: NavItem[] = [
  { href: '/account/book', label: 'Book', icon: <BookIcon /> },
  { href: '/account/bookings', label: 'Bookings', icon: <ListIcon />, also: ['/account/requests'] },
  { href: '/account/dogs', label: 'Dogs', icon: <PawIcon /> },
  {
    href: '/account',
    label: 'Account',
    icon: <PersonIcon />,
    also: [
      '/account/membership',
      '/account/invoices',
      '/account/profile',
      '/account/contacts',
      '/account/faq',
      '/account/terms',
      '/account/data',
      '/account/incidents',
    ],
  },
];

/** Everything else lives in the menu (Account sheet). */
const groups: NavGroup[] = [
  {
    label: 'Day care',
    items: [
      { href: '/account', label: 'Overview' },
      { href: '/account/book', label: 'Book' },
      { href: '/account/bookings', label: 'Bookings' },
      { href: '/account/requests', label: 'Requests' },
      { href: '/account/dogs', label: 'Dogs' },
      { href: '/account/membership', label: 'Membership' },
      { href: '/account/invoices', label: 'Invoices' },
    ],
  },
  {
    label: 'Your account',
    items: [
      { href: '/account/dogs/new', label: 'Add a dog' },
      { href: '/account/profile', label: 'Your details' },
      { href: '/account/contacts', label: 'Contacts' },
      { href: '/account/faq', label: 'Questions' },
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
