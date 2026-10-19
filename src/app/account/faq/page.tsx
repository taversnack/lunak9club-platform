import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, Stack } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { currentFaqs } from '@/server/services/membership-emails';

export const metadata: Metadata = { title: 'Membership questions' };
export const dynamic = 'force-dynamic';

/** D91: the same key answers as the cover email and every membership invoice email. */
export default async function FaqPage() {
  await requirePermission('account.access');
  const faqs = await currentFaqs(getDb());
  return (
    <Stack>
      <h1>Membership questions</h1>
      <p>Short answers about cancelling, changing and adding days, and how each is invoiced or charged.</p>
      {faqs.map((f) => (
        <Card key={f.id} aria-labelledby={`faq-${f.id}`}>
          <h2 id={`faq-${f.id}`}>{f.question}</h2>
          <p>{f.answer}</p>
        </Card>
      ))}
      <p>
        Manage your days in <Link href="/account/membership">Membership</Link> and{' '}
        <Link href="/account/bookings">Your bookings</Link>.
      </p>
    </Stack>
  );
}
