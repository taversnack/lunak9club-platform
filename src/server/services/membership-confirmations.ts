import 'server-only';
import { and, asc, eq, exists, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { bookingDogs, customers, dogs, memberships, users } from '@/infra/db/schema';
import { monthRange, type Month } from '@/domain/billing/rules';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

export type DogToConfirm = { customerId: string; customerName: string; dogId: string; dogName: string };

/**
 * Dogs whose membership days in `month` need the monthly confirmation (D88, D93): the dog has
 * membership days booked that month AND a membership already in place on the 1st. A dog that
 * joined partway through the month is left out: its joining invoice covers that month.
 * Pass `customerId` to look at one customer only.
 */
export async function dogsToConfirm(q: Q, month: Month, customerId?: string): Promise<DogToConfirm[]> {
  const { first, last } = monthRange(month);
  const inPlaceOnFirst = q
    .select({ one: sql`1` })
    .from(memberships)
    .where(
      and(
        eq(memberships.dogId, bookingDogs.dogId),
        inArray(memberships.status, ['active', 'ended']),
        lte(memberships.startsOn, first),
        // A membership replaced or ended before it began is closed with endsOn = startsOn: not in place.
        or(
          isNull(memberships.endsOn),
          and(gte(memberships.endsOn, first), gt(memberships.endsOn, memberships.startsOn)),
        ),
      ),
    );
  return q
    .selectDistinct({
      customerId: bookingDogs.customerId,
      customerName: users.name,
      dogId: bookingDogs.dogId,
      dogName: dogs.name,
    })
    .from(bookingDogs)
    .innerJoin(customers, eq(customers.id, bookingDogs.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .innerJoin(dogs, eq(dogs.id, bookingDogs.dogId))
    .where(
      and(
        customerId ? eq(bookingDogs.customerId, customerId) : undefined,
        eq(bookingDogs.kind, 'membership'),
        gte(bookingDogs.serviceDate, first),
        lte(bookingDogs.serviceDate, last),
        inArray(bookingDogs.status, ['confirmed', 'waitlisted']),
        isNull(customers.anonymisedAt),
        exists(inPlaceOnFirst),
      ),
    )
    .orderBy(asc(users.name), asc(dogs.name));
}
