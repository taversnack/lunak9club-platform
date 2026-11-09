import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { buttonClass, CardGrid, EmptyState, ListingCard, PlaceholderMedia, Stack, StatusBadge } from '@/ui/components';
import { requirePermission } from '@/server/session';
import { getDb } from '@/infra/db/client';
import { listMyDogs } from '@/server/services/dogs';
import { OVERALL_LABELS } from '@/domain/compliance/evaluate';

export const metadata: Metadata = { title: 'Your dogs' };
export const dynamic = 'force-dynamic';

/** Your dogs as listing cards: initial block, name, breed, one status badge, one action (design plan 4.7). */
export default async function DogsPage() {
  const actor = await requirePermission('account.access');
  const dogs = await listMyDogs(getDb(), actor);
  return (
    <Stack>
      <h1>Your dogs</h1>
      {dogs.length === 0 ? (
        <EmptyState
          title="No dogs yet"
          action={
            <Link href="/account/dogs/new" className={buttonClass('primary')}>
              Add your dog
            </Link>
          }
        >
          Add your dog to start their onboarding. You’ll need their vaccination record and vet’s details.
        </EmptyState>
      ) : (
        <>
          <CardGrid>
            {dogs.map((d) => {
              const label = OVERALL_LABELS[d.evaluation.overall];
              const left = d.evaluation.items.filter((i) => i.mandatory && i.action).length;
              return (
                <ListingCard
                  key={d.id}
                  media={<PlaceholderMedia ratio="16 / 9" initial={d.name} />}
                  title={d.name}
                  meta={d.breed}
                  badge={<StatusBadge tone={label.tone}>{label.text}</StatusBadge>}
                  note={left ? `${left} thing${left === 1 ? '' : 's'} to do` : undefined}
                  action={
                    <Link href={`/account/dogs/${d.id}` as Route} className={buttonClass('secondary')}>
                      Open <span className="visually-hidden">{d.name}</span>
                    </Link>
                  }
                />
              );
            })}
          </CardGrid>
          <p>
            <Link href="/account/dogs/new" className={buttonClass('secondary')}>
              Add a dog
            </Link>
          </p>
        </>
      )}
    </Stack>
  );
}
