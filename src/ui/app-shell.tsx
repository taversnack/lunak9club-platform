'use client';
import Image from 'next/image';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, type ReactNode } from 'react';
import s from './shell.module.css';
import { SignOutButton } from './sign-out-button';
import { LinkPending } from './nav-link';

export type NavItem = { href: Route; label: string; icon?: ReactNode; badge?: ReactNode };
export type NavGroup = { label: string; items: NavItem[] };

const isCurrent = (path: string, href: string, root: string) =>
  href === root ? path === root : path === href || path.startsWith(`${href}/`);

function MenuIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function NavList({ groups, path, root, label }: { groups: NavGroup[]; path: string; root: string; label: string }) {
  return (
    <nav aria-label={label}>
      {groups.map((g) => (
        <div key={g.label} className={s.group}>
          <p className={s.groupLabel}>{g.label}</p>
          <ul className={s.navList}>
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} aria-current={isCurrent(path, i.href, root) ? 'page' : undefined}>
                  {i.icon}
                  <span>{i.label}</span>
                  {i.badge ? <span className={s.badgeSlot}>{i.badge}</span> : null}
                  <LinkPending />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Signed-in app frame: sticky header (brand, primary tabs, call-to-action pill, Menu button), an accessible
 * <dialog> drawer (focus trapped by the browser, Esc closes, focus returns to the Menu button), an optional
 * mobile bottom tab bar, and an optional desktop sidebar (Owner area).
 */
export function AppShell({
  root,
  navLabel,
  userName,
  cta,
  tabs,
  groups,
  sidebar,
  children,
}: {
  root: Route;
  navLabel: string;
  userName: string;
  cta?: { href: Route; label: string };
  tabs?: NavItem[];
  groups: NavGroup[];
  sidebar?: boolean;
  children: ReactNode;
}) {
  const path = usePathname() ?? '';
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dialog.current?.open) dialog.current.close();
  }, [path]);

  const open = () => {
    dialog.current?.showModal();
    opener.current?.setAttribute('aria-expanded', 'true');
  };
  const onClose = () => {
    opener.current?.setAttribute('aria-expanded', 'false');
    opener.current?.focus();
  };
  const initial = userName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className={s.shell} data-app-shell="">
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link href="/" className={s.brand}>
            <Image src="/brand/lunak9-logo.png" alt="Luna’s K9 Club home" width={155} height={55} priority />
          </Link>
          {tabs ? (
            <nav aria-label="Main" className={s.tabs}>
              <ul>
                {tabs.map((t) => (
                  <li key={t.href}>
                    <Link href={t.href} aria-current={isCurrent(path, t.href, root) ? 'page' : undefined}>
                      {t.label}
                      <LinkPending />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <div className={s.headerRight}>
            {cta ? (
              <Link href={cta.href} className={s.ctaPill}>
                {cta.label}
                <LinkPending />
              </Link>
            ) : null}
            <span className={s.user}>
              <span className={s.avatar} aria-hidden="true">
                {initial}
              </span>
              <span className={s.userName}>{userName}</span>
            </span>
            <button
              ref={opener}
              type="button"
              className={`${s.menuButton} ${sidebar ? s.menuMobileOnly : ''}`}
              aria-label="Menu"
              aria-haspopup="dialog"
              aria-expanded="false"
              aria-controls="app-drawer"
              onClick={open}
            >
              <MenuIcon />
            </button>
            {sidebar ? (
              <span className={s.desktopOnly}>
                <SignOutButton />
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <dialog
        id="app-drawer"
        ref={dialog}
        className={s.drawer}
        aria-label="Menu"
        onClose={onClose}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <div className={s.drawerHead}>
          <strong>Hi, {userName.split(' ')[0]}</strong>
          <button
            type="button"
            className={s.closeButton}
            aria-label="Close menu"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            <CloseIcon />
          </button>
        </div>
        <div className={s.drawerBody}>
          <NavList groups={groups} path={path} root={root} label={navLabel} />
        </div>
        <div className={s.drawerFoot}>
          {cta ? (
            <Link href={cta.href} className={s.ctaPillDark}>
              {cta.label}
              <LinkPending />
            </Link>
          ) : null}
          <SignOutButton />
        </div>
      </dialog>

      <div className={sidebar ? s.withSidebar : undefined}>
        {sidebar ? (
          <aside className={s.sidebar}>
            <NavList groups={groups} path={path} root={root} label={navLabel} />
          </aside>
        ) : null}
        <div className={s.content}>{children}</div>
      </div>

      {tabs ? (
        <nav aria-label="Main tabs" className={s.tabbar} data-tabbar="">
          <ul>
            {tabs.map((t) => (
              <li key={t.href}>
                <Link href={t.href} aria-current={isCurrent(path, t.href, root) ? 'page' : undefined}>
                  {t.icon}
                  <span>{t.label}</span>
                  <LinkPending />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
