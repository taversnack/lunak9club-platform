/**
 * Key membership FAQs (D91), shared by the cover email, every membership invoice email and the
 * account FAQ page so the wording never drifts. Plain English; no personal or sensitive data.
 * Numbers come from settings so the answers follow the Owner's configuration.
 */
export type FaqSettings = {
  /** Free cancellation notice in hours (D39). */
  freeCancellationHours: number;
  /** Day of the month next month's invoice is sent (D24). */
  sendDay: number;
  /** Days after sending that an invoice is due (D24). */
  paymentTermsDays: number;
  /** Day of the month by which members confirm that month's days (D88). */
  confirmByDay: number;
};

export type FaqItem = { id: string; question: string; answer: string };

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10];
  return `${n}${s ?? 'th'}`;
};

export function membershipFaqs(s: FaqSettings): FaqItem[] {
  const notice = `${s.freeCancellationHours} hours`;
  return [
    {
      id: 'cancel',
      question: 'How do I cancel a day?',
      answer: `Cancel it in Your bookings. If you cancel at least ${notice} before the session starts, there’s no charge – for a membership day you’ve already paid for, we check it and refund it to your card. With less notice the day is still charged.`,
    },
    {
      id: 'change',
      question: 'How do I change my regular days?',
      answer:
        'Ask in Membership or from the day in Your bookings. You can move one day (this occasion only) or change your days for all future months. We approve every change. A one-off move is a straight swap in the same month for the same session and price, with the same notice as cancelling. A change to all future months starts from the next month that hasn’t been invoiced yet. You can only choose days that have space.',
    },
    {
      id: 'extra',
      question: 'How do I add an extra day?',
      answer:
        'Ask for it from Book. We confirm it, and it’s charged at your membership day rate. You’ll see the price before you ask.',
    },
    {
      id: 'invoices',
      question: 'How am I invoiced?',
      answer: `We email next month’s invoice on the ${ordinal(s.sendDay)}. It lists your booked days and is due ${s.paymentTermsDays} days later; pay by card from the invoice. Please confirm your days by the ${ordinal(s.confirmByDay)} of the month. If you don’t, your days stay as they are and the invoice is still due.`,
    },
  ];
}

export { ordinal };
