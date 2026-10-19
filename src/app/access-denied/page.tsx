import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { getActor } from '@/server/session';

export const metadata: Metadata = { title: 'No access' };

export default async function AccessDenied() {
  const actor = await getActor();
  const who = actor.kind === 'user' ? actor.name : null;
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Card>
        <Stack>
          <h1>You don&apos;t have access to this page</h1>
          <p>
            This page is for a different type of account{who ? <> from the one you’re signed in with ({who})</> : null}.
            If you think this is a mistake, please contact Luna’s K9 Club.
          </p>
          <p>
            <Link href="/dashboard">Go to your dashboard</Link> · <Link href="/account/book">Book day care</Link>
          </p>
        </Stack>
      </Card>
    </div>
  );
}
