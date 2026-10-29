import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  APPROVAL_STATUSES,
  canDecide,
  clampSummary,
  isValidApprovalType,
  isValidSubjectKey,
  nextStatus,
  skipsGenericEmail,
  subjectKey,
  SUMMARY_MAX,
  type ApprovalStatus,
} from '@/domain/approvals';
import {
  getApprovalType,
  registerApprovalType,
  registeredApprovalTypes,
  type ApprovalType,
} from '@/server/services/approvals';

describe('approval state machine', () => {
  it('only pending requests can be decided', () => {
    expect(nextStatus('pending', 'approve')).toBe('approved');
    expect(nextStatus('pending', 'reject')).toBe('rejected');
    expect(nextStatus('pending', 'withdraw')).toBe('withdrawn');
    expect(nextStatus('pending', 'expire')).toBe('expired');
    for (const s of APPROVAL_STATUSES.filter((x) => x !== 'pending') as ApprovalStatus[]) {
      expect(canDecide(s)).toBe(false);
      for (const d of ['approve', 'reject', 'withdraw', 'expire'] as const) expect(nextStatus(s, d)).toBeNull();
    }
  });

  it('validates names and subject keys', () => {
    expect(isValidApprovalType('booking.request')).toBe(true);
    expect(isValidApprovalType('membership.move_once')).toBe(true);
    expect(isValidApprovalType('Booking')).toBe(false);
    expect(isValidApprovalType('booking')).toBe(false);
    expect(isValidSubjectKey('booking:7d0c1a9e-0000-4000-8000-000000000000')).toBe(true);
    expect(isValidSubjectKey('booking 1')).toBe(false);
    expect(subjectKey('booking', 'abc')).toBe('booking:abc');
    expect(() => subjectKey('Bad', 'x y')).toThrow();
  });

  it('keeps summaries short', () => {
    expect(clampSummary('  a   b ')).toBe('a b');
    expect(clampSummary('x'.repeat(500))).toHaveLength(SUMMARY_MAX);
  });

  it('generic email skip flag', () => {
    expect(skipsGenericEmail(undefined, 'approved')).toBe(false);
    expect(skipsGenericEmail(true, 'expired')).toBe(true);
    expect(skipsGenericEmail(['approved'], 'approved')).toBe(true);
    expect(skipsGenericEmail(['approved'], 'rejected')).toBe(false);
  });
});

describe('approval registry', () => {
  const def: ApprovalType<{ n: number }> = {
    type: 'test.thing',
    label: 'Test request',
    emailNoun: 'test request',
    schema: z.object({ n: z.number() }),
    describe: (p) => `Thing ${p.n}`,
    onApprove: async () => {},
    onReject: async () => {},
  };

  it('registers once and finds the type', () => {
    registerApprovalType(def);
    registerApprovalType(def); // same object again is a no-op
    expect(getApprovalType('test.thing')?.label).toBe('Test request');
    expect(registeredApprovalTypes()).toContainEqual({ type: 'test.thing', label: 'Test request' });
  });

  it('refuses a clashing or badly named type', () => {
    expect(() => registerApprovalType({ ...def })).toThrow(/already registered/);
    expect(() => registerApprovalType({ ...def, type: 'nodot' })).toThrow(/Invalid/);
  });
});

describe('approval and booking-request emails (D76, D80)', () => {
  it('the request email carries the agreed "does not secure" wording', async () => {
    const { bookingRequestedMessage } = await import('@/infra/email/templates');
    const { REQUEST_NOT_SECURED, REQUEST_NOT_SECURED_KEY } = await import('@/domain/booking/wording');
    const m = bookingRequestedMessage(
      'a@example.test',
      'Alice',
      [{ dogName: 'Biscuit', dateText: 'Mon 2 Nov 2026', sessionText: 'Full day', outcome: 'requested' }],
      'https://app.test/account/bookings',
    );
    expect(REQUEST_NOT_SECURED).toContain(REQUEST_NOT_SECURED_KEY);
    expect(m.text).toContain(REQUEST_NOT_SECURED);
    expect(m.html).toContain(REQUEST_NOT_SECURED_KEY);
  });

  it('the approval email says pay to secure, with the link and the London deadline', async () => {
    const { paymentLinkMessage } = await import('@/infra/email/templates');
    const { PAY_TO_SECURE_KEY } = await import('@/domain/booking/wording');
    const m = paymentLinkMessage(
      'a@example.test',
      'Alice',
      {
        amountText: '£50.00',
        forText: 'day care for Biscuit (1 session)',
        untilText: '3 Nov 2026, 08:00',
        approved: true,
      },
      'https://app.test/api/payments/pay/abc',
    );
    expect(m.template).toBe('booking.request-approved');
    for (const part of [m.text, m.html]) {
      expect(part).toContain(PAY_TO_SECURE_KEY);
      expect(part).toContain('https://app.test/api/payments/pay/abc');
      expect(part).toContain('3 Nov 2026, 08:00');
    }
  });

  it('decision emails have no place for the Owner’s note', async () => {
    const { approvalDecisionMessage } = await import('@/infra/email/templates');
    // The template takes only noun, summary and outcome – a note can't be passed in.
    expect(approvalDecisionMessage.length).toBe(4);
    for (const outcome of ['approved', 'rejected', 'withdrawn', 'expired'] as const) {
      const m = approvalDecisionMessage(
        'a@example.test',
        'Alice',
        { noun: 'booking request', summary: 'Day care · 1 dog-day · £50.00', outcome },
        'https://app.test/account/bookings',
      );
      expect(Object.keys(m).sort()).toEqual(['html', 'subject', 'template', 'text', 'to']);
      expect(m.text).not.toMatch(/note|reason/i);
    }
  });
});
