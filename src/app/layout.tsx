import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import '@fontsource/raleway/400.css';
import '@fontsource/raleway/600.css';
import '@fontsource/raleway/700.css';
import './globals.css';
import s from '@/ui/ui.module.css';

export const metadata: Metadata = {
  title: { default: 'Luna’s K9 Club', template: '%s · Luna’s K9 Club' },
  description: 'Book dog day care, manage your dogs and pay invoices with Luna’s K9 Club.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#283039' };

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
              <Image src="/brand/lunak9-logo.png" alt="Luna’s K9 Club home" width={200} height={71} priority />
            </Link>
            <nav aria-label="Main" className={s.nav}>
              <Link href="/dashboard">My dashboard</Link>
            </nav>
          </div>
        </header>
        <main id="main" className={s.main} tabIndex={-1}>
          {children}
        </main>
        <footer className={s.footer}>
          <div className={s.container}>
            <p>© {new Date().getFullYear()} Luna&rsquo;s K9 Club Ltd · Central Bedfordshire</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
