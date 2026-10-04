import type { Metadata } from 'next';
import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';

export const metadata: Metadata = { title: 'No access' };

export default function AccessDenied() {
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Card>
        <Stack>
          <h1>You don&apos;t have access to this page</h1>
          <p>If you think this is a mistake, please contact Luna’s K9 Club.</p>
          <p>
            <Link href="/dashboard">Go to your dashboard</Link>
          </p>
        </Stack>
      </Card>
    </div>
  );
}
