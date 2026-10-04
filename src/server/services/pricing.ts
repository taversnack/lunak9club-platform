import 'server-only';
import { and, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '@/infra/db/client';
import { customerRates, customers, dogs, memberships, priceBooks, priceSnapshots, users } from '@/infra/db/schema';
import { priceDogDay, type Band, type CustomerRate, type Price, type PriceBook } from '@/domain/pricing/engine';
import type { Session } from '@/domain/booking/rules';
import { addDays, londonDate, type IsoDate } from '@/domain/time';
import { assertAuthorized, type Actor } from '../policy/authorize';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { idOrNotFound, isoDate, parseInput, requiredText } from '../validation';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

export type PricingContext = {
  books: PriceBook[];
  rates: CustomerRate[];
  /** Active memberships per dog: [{from, to, daysPerWeek}] */
  memberships: Map<string, { from: IsoDate; to: IsoDate | null; daysPerWeek: number }[]>;
};

/** Load everything needed to price a customer's dog-days between two dates. */
export async function loadPricingContext(
  db: Q,
  customerId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<PricingContext> {
  const [books, rates, ms] = await Promise.all([
    db
      .select()
      .from(priceBooks)
      .where(
        and(lte(priceBooks.effectiveFrom, to), or(isNull(priceBooks.effectiveTo), gte(priceBooks.effectiveTo, from))),
      ),
    db
      .select()
      .from(customerRates)
      .where(
        and(
          eq(customerRates.customerId, customerId),
          lte(customerRates.startsOn, to),
          or(isNull(customerRates.endsOn), gte(customerRates.endsOn, from)),
        ),
      ),
    db
      .select({
        dogId: memberships.dogId,
        startsOn: memberships.startsOn,
        endsOn: memberships.endsOn,
        weekdays: memberships.weekdays,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.customerId, customerId),
          inArray(memberships.status, ['active', 'ended']),
          lte(memberships.startsOn, to),
          or(isNull(memberships.endsOn), gte(memberships.endsOn, from)),
        ),
      ),
  ]);
  const map = new Map<string, { from: IsoDate; to: IsoDate | null; daysPerWeek: number }[]>();
  for (const m of ms) {
    const list = map.get(m.dogId) ?? [];
    list.push({ from: m.startsOn, to: m.endsOn, daysPerWeek: m.weekdays.length });
    map.set(m.dogId, list);
  }
  return { books, rates, memberships: map };
}

export function membershipDaysOn(ctx: PricingContext, dogId: string, date: IsoDate): number | null {
  const m = ctx.memberships.get(dogId)?.find((x) => date >= x.from && (x.to === null || date <= x.to));
  return m ? m.daysPerWeek : null;
}

export function priceWith(
  ctx: PricingContext,
  p: {
    dogId: string;
    date: IsoDate;
    session: Session;
    taxi: boolean;
    dogIndexOnDate: number;
    isTrial?: boolean;
    trialBand?: Band | null;
  },
): Price {
  return priceDogDay({
    ...p,
    membershipDaysPerWeek: membershipDaysOn(ctx, p.dogId, p.date),
    books: ctx.books,
    customerRates: ctx.rates.map((r) => ({ ...r })),
  });
}

/** Lock a price onto a booked dog-day (D45). Rows are immutable once written. */
export async function writeSnapshot(tx: Tx, bookingDogId: string, price: Price) {
  await tx.insert(priceSnapshots).values({ bookingDogId, ...price });
}

// ---- Owner: price books ------------------------------------------------------

export async function listPriceBooks(db: Db, actor: Actor) {
  assertAuthorized(actor, 'pricing.manage');
  return db.select().from(priceBooks).orderBy(desc(priceBooks.effectiveFrom));
}

const pence = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/^£/, ''))
    .refine((v) => /^\d{1,4}(\.\d{1,2})?$/.test(v), `Enter ${label} in pounds, like 48 or 22.50`)
    .transform((v) => Math.round(Number(v) * 100));

export const PriceBookInput = z
  .object({
    name: requiredText('a name', 80),
    effectiveFrom: isoDate('the start date'),
    adHocFull: pence('the ad hoc full-day price'),
    memberLowFull: pence('the 1–3 days a week price'),
    memberHighFull: pence('the 4–5 days a week price'),
    halfDayPercent: z.coerce.number().int().min(1, 'Use 1–100').max(100, 'Use 1–100'),
    taxi: pence('the taxi price'),
    multiDogDiscountPercent: z.coerce.number().int().min(0, 'Use 0–100').max(100, 'Use 0–100'),
  })
  .refine((d) => d.memberHighFull <= d.memberLowFull && d.memberLowFull <= d.adHocFull, {
    message: 'Usually ad hoc ≥ 1–3 days ≥ 4–5 days. Check the prices.',
    path: ['memberHighFull'],
  });

/**
 * Schedule new prices from a future date. The book currently open-ended is closed the day
 * before. Existing bookings keep the price they were booked at (D45).
 */
export async function schedulePriceBook(db: Db, actor: Actor, input: unknown, now = new Date()) {
  assertAuthorized(actor, 'pricing.manage');
  const d = parseInput(PriceBookInput, input);
  const today = londonDate(now);
  if (d.effectiveFrom <= today)
    throw new ValidationError('Please check the highlighted fields.', {
      effectiveFrom: 'New prices must start from tomorrow or later',
    });
  return db.transaction(async (tx) => {
    const later = await tx
      .select({ id: priceBooks.id })
      .from(priceBooks)
      .where(gte(priceBooks.effectiveFrom, d.effectiveFrom));
    if (later.length)
      throw new ConflictError('Prices are already scheduled from that date or later. Remove those first.');
    const [open] = await tx.select().from(priceBooks).where(isNull(priceBooks.effectiveTo)).for('update');
    if (open)
      await tx
        .update(priceBooks)
        .set({ effectiveTo: addDays(d.effectiveFrom, -1) })
        .where(eq(priceBooks.id, open.id));
    const [row] = await tx
      .insert(priceBooks)
      .values({
        name: d.name,
        effectiveFrom: d.effectiveFrom,
        adHocFullPence: d.adHocFull,
        memberLowFullPence: d.memberLowFull,
        memberHighFullPence: d.memberHighFull,
        halfDayPercent: d.halfDayPercent,
        taxiPence: d.taxi,
        multiDogDiscountPercent: d.multiDogDiscountPercent,
        createdBy: actor.kind === 'user' ? actor.userId : null,
      })
      .returning({ id: priceBooks.id });
    await recordAudit(tx, {
      actor,
      action: 'pricing.book_scheduled',
      entityType: 'price_book',
      entityId: row!.id,
      metadata: {
        effectiveFrom: d.effectiveFrom,
        adHocFull: d.adHocFull,
        memberLowFull: d.memberLowFull,
        memberHighFull: d.memberHighFull,
      },
    });
    return row!.id;
  });
}

/** Remove a price book that hasn't started yet; the previous one becomes open-ended again. */
export async function removeScheduledPriceBook(db: Db, actor: Actor, rawId: string, now = new Date()) {
  assertAuthorized(actor, 'pricing.manage');
  const id = idOrNotFound(rawId, 'Price book');
  const today = londonDate(now);
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(priceBooks).where(eq(priceBooks.id, id)).for('update');
    if (!b) throw new NotFoundError('Price book');
    if (b.effectiveFrom <= today)
      throw new ConflictError('Prices already in use can’t be removed. Schedule new prices instead.');
    if (b.effectiveTo !== null) throw new ConflictError('Remove the latest scheduled prices first.');
    const used = await tx
      .select({ id: priceSnapshots.id })
      .from(priceSnapshots)
      .where(eq(priceSnapshots.priceBookId, id))
      .limit(1);
    if (used.length)
      throw new ConflictError('Bookings are already priced with these prices, so they can’t be removed.');
    await tx.delete(priceBooks).where(eq(priceBooks.id, id));
    await tx
      .update(priceBooks)
      .set({ effectiveTo: null })
      .where(eq(priceBooks.effectiveTo, addDays(b.effectiveFrom, -1)));
    await recordAudit(tx, { actor, action: 'pricing.book_removed', entityType: 'price_book', entityId: id });
  });
}

/** Customer-facing current prices (for the membership page). */
export async function currentPrices(db: Db, now = new Date()) {
  const today = londonDate(now);
  const [b] = await db
    .select()
    .from(priceBooks)
    .where(
      and(lte(priceBooks.effectiveFrom, today), or(isNull(priceBooks.effectiveTo), gte(priceBooks.effectiveTo, today))),
    );
  return b ?? null;
}

// ---- Owner: customer-specific rates -------------------------------------------

export const CustomerRateInput = z.object({
  dogId: z
    .string()
    .optional()
    .transform((v) => (v && v !== 'all' ? v : null)),
  fullDay: pence('the full-day price'),
  halfDay: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine(
      (v) => v === null || /^£?\d{1,4}(\.\d{1,2})?$/.test(v),
      'Enter the half-day price in pounds, or leave it blank',
    )
    .transform((v) => (v === null ? null : Math.round(Number(v.replace(/^£/, '')) * 100))),
  startsOn: isoDate('the start date'),
  endsOn: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null)),
  reason: requiredText('a reason (the customer sees this)', 120),
});

export async function listCustomerRates(db: Db, actor: Actor, rawCustomerId: string) {
  assertAuthorized(actor, 'pricing.manage');
  const customerId = idOrNotFound(rawCustomerId, 'Customer');
  return db
    .select({ rate: customerRates, dogName: dogs.name })
    .from(customerRates)
    .leftJoin(dogs, eq(dogs.id, customerRates.dogId))
    .where(eq(customerRates.customerId, customerId))
    .orderBy(desc(customerRates.startsOn));
}

export async function addCustomerRate(db: Db, actor: Actor, rawCustomerId: string, input: unknown) {
  assertAuthorized(actor, 'pricing.manage');
  const customerId = idOrNotFound(rawCustomerId, 'Customer');
  const d = parseInput(CustomerRateInput, input);
  if (d.endsOn && d.endsOn < d.startsOn)
    throw new ValidationError('Please check the highlighted fields.', {
      endsOn: 'The end date must be after the start date',
    });
  const [c] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
  if (!c) throw new NotFoundError('Customer');
  if (d.dogId) {
    const [dog] = await db
      .select({ id: dogs.id })
      .from(dogs)
      .where(and(eq(dogs.id, idOrNotFound(d.dogId, 'Dog')), eq(dogs.customerId, customerId)));
    if (!dog)
      throw new ValidationError('Please check the highlighted fields.', {
        dogId: 'That dog doesn’t belong to this customer',
      });
  }
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(customerRates)
      .values({
        customerId,
        dogId: d.dogId,
        fullDayPence: d.fullDay,
        halfDayPence: d.halfDay,
        startsOn: d.startsOn,
        endsOn: d.endsOn,
        reason: d.reason,
        createdBy: actor.kind === 'user' ? actor.userId : null,
      })
      .returning({ id: customerRates.id });
    await recordAudit(tx, {
      actor,
      action: 'pricing.customer_rate_added',
      entityType: 'customer',
      entityId: customerId,
      metadata: { rateId: row!.id, fullDay: d.fullDay },
    });
  });
}

export async function endCustomerRate(db: Db, actor: Actor, rawRateId: string, now = new Date()) {
  assertAuthorized(actor, 'pricing.manage');
  const id = idOrNotFound(rawRateId, 'Rate');
  const today = londonDate(now);
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(customerRates).where(eq(customerRates.id, id)).for('update');
    if (!r) throw new NotFoundError('Rate');
    const endsOn = r.startsOn > today ? r.startsOn : today;
    await tx.update(customerRates).set({ endsOn }).where(eq(customerRates.id, id));
    await recordAudit(tx, {
      actor,
      action: 'pricing.customer_rate_ended',
      entityType: 'customer',
      entityId: r.customerId,
      metadata: { rateId: id },
    });
  });
}

export async function customerIdForUser(db: Db, userId: string) {
  const [c] = await db
    .select({ id: customers.id, name: users.name })
    .from(customers)
    .innerJoin(users, eq(users.id, customers.userId))
    .where(eq(customers.userId, userId));
  return c ?? null;
}
