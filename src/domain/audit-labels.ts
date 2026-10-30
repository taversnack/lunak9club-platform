/** Plain-English labels for audit actions shown to the Owner (UI review #5). */
const LABELS: Record<string, string> = {
  'auth.signed_in': 'Signed in',
  'auth.registered': 'Created an account',
  'auth.email_verified': 'Confirmed their email',
  'auth.password_reset': 'Reset their password',
  'authz.denied': 'Was refused access',
  'role.granted': 'Role given',
  'role.revoked': 'Role removed',
  'booking.created': 'Booking made',
  'booking.cancelled': 'Booking cancelled',
  'booking.hold_cancelled': 'Unpaid booking cancelled',
  'booking.place_offered': 'Waitlist place offered',
  'booking.offer_accepted': 'Waitlist place accepted',
  'booking.note_updated': 'Booking note changed',
  'payment.checkout_started': 'Card payment started',
  'payment.checkout_released': 'Unpaid places released',
  'payment.booking_paid': 'Booking paid',
  'payment.card_received': 'Card payment received',
  'invoice.issued': 'Invoice issued',
  'invoice.sent': 'Invoice emailed',
  'invoice.bulk_approved': 'Unchanged drafts approved together',
  'invoice.payment_recorded': 'Payment recorded',
  'invoice.credited': 'Credit note issued',
  'refund.requested': 'Refund requested',
  'dog.created': 'Dog added',
  'dog.onboarding_submitted': 'Onboarding form sent',
  'document.uploaded': 'Record uploaded',
  'document.downloaded': 'Record downloaded',
  'incident.reported': 'Incident reported',
  'incident.acknowledged': 'Incident report read',
  'welfare.checked': 'Daily check recorded',
  'membership.approved': 'Membership approved',
  'terms.accepted': 'Terms accepted',
  'data.exported': 'Downloaded their data',
  'data.erasure_requested': 'Asked for their account to be deleted',
  'retention.run': 'Old records tidied up',
};

/** "payment.checkout_started" → "Card payment started"; unknown codes become readable words. */
export function auditActionLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  const [area = '', what = ''] = action.split('.');
  const words = `${area.replace(/_/g, ' ')}: ${what.replace(/_/g, ' ')}`.trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "booking_dog" → "Booking". */
export function auditEntityLabel(entityType: string): string {
  const special: Record<string, string> = { booking_dog: 'Booking', checkout_attempt: 'Card payment', user: 'Account' };
  const w = special[entityType] ?? entityType.replace(/_/g, ' ');
  return w.charAt(0).toUpperCase() + w.slice(1);
}
