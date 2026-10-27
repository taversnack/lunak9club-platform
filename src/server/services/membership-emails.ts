import 'server-only';
import type { Db } from '@/infra/db/client';
import { formatMonth } from '@/domain/billing/rules';
import { confirmByDate } from '@/domain/membership/rules';
import { membershipFaqs, type FaqItem } from '@/domain/membership/faq';
import { formatUkDate, londonDate } from '@/domain/time';
import type { InvoiceMembershipExtras } from '@/infra/email/templates';
import { appUrl } from '../notify';
import { loadSettings } from './booking-shared';
import { eq } from 'drizzle-orm';
import { businessSettings } from '@/infra/db/schema';
import { dogsToConfirm } from './membership-confirmations';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

// Read directly (not via billing.ts) so billing can import this module without a cycle.
async function loadBusinessSettings(q: Q) {
  const [row] = await q.select().from(businessSettings).where(eq(businessSettings.id, 1));
  if (!row) throw new Error('business_settings row missing – run migrations');
  return row;
}

/** The FAQ (D91) with the Owner's current settings. */
export async function currentFaqs(q: Q): Promise<FaqItem[]> {
  const [booking, bs] = await Promise.all([loadSettings(q), loadBusinessSettings(q)]);
  return membershipFaqs({
    freeCancellationHours: booking.freeCancellationHours,
    sendDay: bs.sendDay,
    paymentTermsDays: bs.paymentTermsDays,
    confirmByDay: bs.confirmByDay,
  });
}

/**
 * Extras for a membership invoice email: the "confirm your days" section while the confirm-by
 * date hasn't passed and the customer has days to confirm (not a joining month, D93), and the FAQ. Booking (pay-at-booking) invoices get nothing extra.
 */
export async function invoiceEmailExtras(
  q: Q,
  inv: { kind: string; periodMonth: string; customerId: string },
  now = new Date(),
): Promise<InvoiceMembershipExtras> {
  if (inv.kind !== 'membership') return {};
  const bs = await loadBusinessSettings(q);
  const by = confirmByDate(inv.periodMonth, bs.confirmByDay);
  const faqs = await currentFaqs(q);
  if (by < londonDate(now)) return { faqs };
  // A dog's joining month is covered by the joining invoice: nothing to confirm (D93).
  if (!(await dogsToConfirm(q, inv.periodMonth, inv.customerId)).length) return { faqs };
  return {
    confirm: {
      monthText: formatMonth(inv.periodMonth),
      byText: formatUkDate(by),
      url: appUrl(`/account/membership?confirm=${inv.periodMonth}#confirm`),
    },
    faqs,
  };
}
