import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';

export default function NotFound() {
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Card>
        <Stack>
          <h1>Page not found</h1>
          <p>We couldn’t find that page. It may have moved, or the link may be out of date.</p>
          <p>
            <Link href="/dashboard">Go to your dashboard</Link> · <Link href="/account/book">Book day care</Link> ·{' '}
            <Link href="/">Home</Link>
          </p>
        </Stack>
      </Card>
    </div>
  );
}
