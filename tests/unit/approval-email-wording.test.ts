import { describe, expect, it } from 'vitest';
import '@/server/services/approval-types';
import { getApprovalType, registeredApprovalTypes } from '@/server/services/approvals';
import { approvalDecisionMessage, approvalRequestedOwnerMessage, type ApprovalOutcome } from '@/infra/email/templates';

const OUTCOMES: ApprovalOutcome[] = ['approved', 'rejected', 'withdrawn', 'expired'];
const B = 'Luna’s K9 Club';

function subjects(type: string) {
  const noun = getApprovalType(type)!.emailNoun;
  const owner = approvalRequestedOwnerMessage('o@example.test', { noun }, 'https://app.test/admin/approvals');
  const decisions = Object.fromEntries(
    OUTCOMES.map((outcome) => [
      outcome,
      approvalDecisionMessage('a@example.test', 'Alice', { noun, summary: 'x', outcome }, 'https://app.test/account')
        .subject,
    ]),
  );
  return { owner: owner.subject, ownerText: owner.text, ...decisions };
}

describe('approval email subjects read properly for every request type', () => {
  it.each([
    [
      'membership.days',
      {
        owner: `${B}: new membership days request to review`,
        ownerText: expect.stringContaining('A customer has sent a membership days request.'),
        approved: `${B}: your membership days request has been approved`,
        rejected: `${B}: about your membership days request`,
        withdrawn: `${B}: your membership days request has been withdrawn`,
        expired: `${B}: your membership days request is no longer open`,
      },
    ],
    [
      'membership.move_once',
      {
        owner: `${B}: new request to move a membership day to review`,
        ownerText: expect.stringContaining('A customer has sent a request to move a membership day.'),
        approved: `${B}: your request to move a membership day has been approved`,
        rejected: `${B}: about your request to move a membership day`,
        withdrawn: `${B}: your request to move a membership day has been withdrawn`,
        expired: `${B}: your request to move a membership day is no longer open`,
      },
    ],
    [
      'booking.request',
      {
        owner: `${B}: new booking request to review`,
        ownerText: expect.stringContaining('A customer has sent a booking request.'),
        approved: `${B}: your booking request has been approved`,
        rejected: `${B}: about your booking request`,
        withdrawn: `${B}: your booking request has been withdrawn`,
        expired: `${B}: your booking request is no longer open`,
      },
    ],
  ])('%s', (type, expected) => {
    expect(subjects(type)).toEqual(expected);
  });

  it('every registered type is covered above and has a sentence-ready noun', () => {
    const types = registeredApprovalTypes().map((t) => t.type);
    expect(types.sort()).toEqual(['booking.request', 'membership.days', 'membership.move_once']);
    for (const t of types) {
      const noun = getApprovalType(t)!.emailNoun;
      expect(noun).toBe(noun.toLowerCase());
      expect(noun).toMatch(/request/);
      for (const s of Object.values(subjects(t))) expect(s).not.toMatch(/days has|new move|your move|\s{2}/);
    }
  });
});
