import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import p from '@/ui/public.module.css';
import { buttonClass, Card, Stack } from '@/ui/components';
import { getActor } from '@/server/session';

export const metadata: Metadata = { title: 'Page not found' };

export default async function NotFound() {
  // Signed-out visitors would just bounce from the dashboard or booking page to sign-in, so offer
  // sign-in and the home page instead.
  const signedIn = (await getActor()).kind !== 'anonymous';
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Card as="div">
        <div className={p.error}>
          <Stack>
            <p className={p.errorCode} aria-hidden="true">
              404
            </p>
            <h1>Page not found</h1>
            <p className={s.muted}>We couldn’t find that page. It may have moved, or the link may be out of date.</p>
            <div className={p.errorActions}>
              {signedIn ? (
                <>
                  <Link href="/dashboard" className={buttonClass('primary')}>
                    Go to your dashboard
                  </Link>
                  <Link href="/account/book" className={buttonClass('secondary')}>
                    Book day care
                  </Link>
                </>
              ) : (
                <Link href="/sign-in" className={buttonClass('primary')}>
                  Sign in
                </Link>
              )}
            </div>
            <p>
              <Link href="/">Home</Link>
            </p>
          </Stack>
        </div>
      </Card>
    </div>
  );
}
