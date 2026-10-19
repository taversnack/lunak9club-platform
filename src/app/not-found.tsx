import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';
import { getActor } from '@/server/session';

export default async function NotFound() {
  // Signed-out visitors would just bounce from the dashboard or booking page to sign-in, so offer
  // sign-in and the home page instead.
  const signedIn = (await getActor()).kind !== 'anonymous';
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Card>
        <Stack>
          <h1>Page not found</h1>
          <p>We couldn’t find that page. It may have moved, or the link may be out of date.</p>
          <p>
            {signedIn ? (
              <>
                <Link href="/dashboard">Go to your dashboard</Link> · <Link href="/account/book">Book day care</Link> ·{' '}
                <Link href="/">Home</Link>
              </>
            ) : (
              <>
                <Link href="/sign-in">Sign in</Link> · <Link href="/">Home</Link>
              </>
            )}
          </p>
        </Stack>
      </Card>
    </div>
  );
}
