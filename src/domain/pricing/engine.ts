import type { IsoDate } from '../time';
import type { Session } from '../booking/rules';

/**
 * Pure, deterministic pricing (D44–D46). Given the price book in force on a date and the facts
 * about a dog-day, return an explained price in pence. No I/O, no floats for money.
 */
export type PriceBook = {
  id: string;
  name: string;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  adHocFullPence: number;
  memberLowFullPence: number;
  memberHighFullPence: number;
  memberHighFromDays: number;
  halfDayPercent: number;
  taxiPence: number;
  multiDogDiscountPercent: number;
};

export type CustomerRate = {
  id: string;
  dogId: string | null;
  fullDayPence: number;
  halfDayPence: number | null;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  reason: string;
};

export type Band = 'low' | 'high';

export type PriceInput = {
  date: IsoDate;
  session: Session;
  taxi: boolean;
  dogId: string;
  /** Days per week of the dog's membership in force on this date, if any. */
  membershipDaysPerWeek: number | null;
  /** Trial days: the band the Owner chose, or null for ad hoc (D21). */
  trialBand?: Band | null;
  isTrial?: boolean;
  /** 0 for the first dog of this customer on this date, 1 for the second, … */
  dogIndexOnDate: number;
  books: readonly PriceBook[];
  customerRates: readonly CustomerRate[];
};

export type Price = {
  priceBookId: string | null;
  customerRateId: string | null;
  rateCode: string;
  basePence: number;
  discountPence: number;
  taxiPence: number;
  totalPence: number;
  explanation: string;
};

const within = (date: IsoDate, from: IsoDate, to: IsoDate | null) => date >= from && (to === null || date <= to);

export function bookFor(books: readonly PriceBook[], date: IsoDate): PriceBook {
  const b = books.find((x) => within(date, x.effectiveFrom, x.effectiveTo));
  if (!b) throw new Error(`No price book covers ${date}`);
  return b;
}

export function bandFor(daysPerWeek: number, book: Pick<PriceBook, 'memberHighFromDays'>): Band {
  return daysPerWeek >= book.memberHighFromDays ? 'high' : 'low';
}

/** Round half up to the nearest penny (e.g. 50% of £45 = £22.50 exactly; 1/3 splits round sensibly). */
const pct = (pence: number, percent: number) => Math.floor((pence * percent + 50) / 100);

export const pounds = (p: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(p / 100);

export function priceDogDay(input: PriceInput): Price {
  const book = bookFor(input.books, input.date);
  const half = input.session !== 'full';
  const sessionText = half ? 'half day' : 'full day';

  // 1–2: customer-specific rates, dog-specific first (D46).
  const rates = input.customerRates.filter((r) => within(input.date, r.startsOn, r.endsOn));
  const custom = rates.find((r) => r.dogId === input.dogId) ?? rates.find((r) => r.dogId === null);

  let base: number;
  let rateCode: string;
  let why: string;
  let customerRateId: string | null = null;

  if (custom) {
    base = half ? (custom.halfDayPence ?? pct(custom.fullDayPence, book.halfDayPercent)) : custom.fullDayPence;
    rateCode = half ? 'custom_half' : 'custom_full';
    why = `Your agreed rate (${custom.reason})`;
    customerRateId = custom.id;
  } else {
    const band: Band | null = input.isTrial
      ? (input.trialBand ?? null)
      : input.membershipDaysPerWeek !== null
        ? bandFor(input.membershipDaysPerWeek, book)
        : null;
    const full =
      band === 'high' ? book.memberHighFullPence : band === 'low' ? book.memberLowFullPence : book.adHocFullPence;
    base = half ? pct(full, book.halfDayPercent) : full;
    const bandText =
      band === 'high'
        ? `${book.memberHighFromDays}–5 days a week rate`
        : band === 'low'
          ? `1–${book.memberHighFromDays - 1} days a week rate`
          : 'ad hoc rate';
    rateCode = `${input.isTrial ? 'trial_' : ''}${band ? `member_${band}` : 'ad_hoc'}_${half ? 'half' : 'full'}`;
    why = `${input.isTrial ? 'Trial day at the ' : ''}${input.isTrial ? bandText : bandText.charAt(0).toUpperCase() + bandText.slice(1)}${half ? ` (${book.halfDayPercent}% of ${pounds(full)})` : ''}`;
  }

  const discount =
    input.dogIndexOnDate > 0 && book.multiDogDiscountPercent > 0 ? pct(base, book.multiDogDiscountPercent) : 0;
  const taxi = input.taxi ? book.taxiPence : 0;
  const parts = [`${why}, ${sessionText}: ${pounds(base)}`];
  if (discount) parts.push(`multi-dog discount ${book.multiDogDiscountPercent}%: −${pounds(discount)}`);
  if (input.taxi) parts.push(taxi ? `dog taxi: ${pounds(taxi)}` : 'dog taxi included');
  return {
    priceBookId: book.id,
    customerRateId,
    rateCode,
    basePence: base,
    discountPence: discount,
    taxiPence: taxi,
    totalPence: base - discount + taxi,
    explanation: parts.join('; '),
  };
}
