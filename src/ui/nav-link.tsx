'use client';
import Link, { useLinkStatus } from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import s from '@/ui/ui.module.css';

/** Shown inside a link while its page loads: a bar along the top, and "Loading" for screen readers. */
export function LinkPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <>
      <span className={s.navPending} aria-hidden="true" />
      <span className="visually-hidden" role="status">
        Loading…
      </span>
    </>
  );
}

/**
 * A navigation link that shows it's loading. Feedback is client-side on purpose: a route-level
 * loading.tsx would stream every page, and pages calling notFound() would then answer 200, not 404.
 */
export function NavLink({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link href={href}>
      {children}
      <LinkPending />
    </Link>
  );
}
