import { describe, expect, it } from 'vitest';
import { auditActionLabel, auditEntityLabel } from '@/domain/audit-labels';

describe('Owner dashboard activity labels', () => {
  it('shows plain English for known events', () => {
    expect(auditActionLabel('auth.signed_in')).toBe('Signed in');
    expect(auditActionLabel('payment.checkout_started')).toBe('Card payment started');
    expect(auditActionLabel('authz.denied')).toBe('Was refused access');
    expect(auditActionLabel('role.granted')).toBe('Role given');
  });
  it('never shows a raw code, even for events without a label', () => {
    const l = auditActionLabel('pricing.customer_rate_added');
    expect(l).not.toMatch(/[._]/);
    expect(l).toBe('Pricing: customer rate added');
    expect(auditEntityLabel('booking_dog')).toBe('Booking');
    expect(auditEntityLabel('price_book')).toBe('Price book');
  });
});
