import Link from 'next/link';
import s from '@/ui/ui.module.css';
import p from '@/ui/public.module.css';
import { buttonClass, Card, Stack } from '@/ui/components';

export default function NotFound() {
  return (
    <div className={s.container}>
      <Card as="div">
        <div className={p.error}>
          <Stack>
            <p className={p.errorCode} aria-hidden="true">
              404
            </p>
            <h1>Page not found</h1>
            <p className={s.muted}>
              This page may have moved, or the link might be out of date. Try one of these instead.
            </p>
            <div className={p.errorActions}>
              <Link href="/dashboard" className={buttonClass('primary')}>
                Go to your dashboard
              </Link>
              <Link href="/account/book" className={buttonClass('secondary')}>
                Book day care
              </Link>
            </div>
            <p>
              <Link href="/">Go to the home page</Link>
            </p>
          </Stack>
        </div>
      </Card>
    </div>
  );
}
