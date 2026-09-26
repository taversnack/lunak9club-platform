import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';
import s from '@/ui/ui.module.css';

export const metadata: Metadata = {
  title: { default: 'LunaK9 Club', template: '%s · LunaK9 Club' },
  description: 'Book dog day care, manage your dogs and pay invoices with LunaK9 Club.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#7a4a2a' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <a className="skip-link" href="#main">
          Skip to main content
        </a>
        <header className={s.header}>
          <div className={`${s.container} ${s.headerInner}`}>
            <Link href="/" className={s.brand}>
              LunaK9 Club
            </Link>
            <nav aria-label="Main" className={s.nav}>
              <Link href="/dashboard">My dashboard</Link>
            </nav>
          </div>
        </header>
        <main id="main" className={s.main} tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
