import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import p from '@/ui/public.module.css';
import { buttonClass, Card, Stack } from '@/ui/components';
import { getActor } from '@/server/session';

export const metadata: Metadata = { title: 'No access' };
export const dynamic = 'force-dynamic';

export default async function AccessDenied() {
  const actor = await getActor();
  const who = actor.kind === 'anonymous' ? null : actor.name;
  return (
    <div className={s.container}>
      <Card as="div">
        <div className={p.error}>
          <Stack>
            <h1>You don&apos;t have access to this page</h1>
            <p className={s.muted}>
              {who ? <>You’re signed in as {who}. </> : null}If you think this is a mistake, please contact Luna’s K9
              Club.
            </p>
            <div className={p.errorActions}>
              <Link href="/dashboard" className={buttonClass('primary')}>
                Go to your dashboard
              </Link>
              <Link href="/account/book" className={buttonClass('secondary')}>
                Book day care
              </Link>
            </div>
          </Stack>
        </div>
      </Card>
    </div>
  );
}
