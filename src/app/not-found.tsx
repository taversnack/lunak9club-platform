import Link from 'next/link';
import s from '@/ui/ui.module.css';
import { Card, Stack } from '@/ui/components';

export default function NotFound() {
  return (
    <div className={`${s.container} ${s.narrow}`}>
      <Card>
        <Stack>
          <h1>Page not found</h1>
          <p>
            <Link href="/">Go to the home page</Link>
          </p>
        </Stack>
      </Card>
    </div>
  );
}
