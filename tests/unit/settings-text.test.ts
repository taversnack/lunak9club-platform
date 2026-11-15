import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  daysText,
  hoursText,
  INVITE_DAYS,
  MAGIC_LINK_MINUTES,
  minutesText,
  RESET_PASSWORD_HOURS,
  VERIFY_EMAIL_HOURS,
} from '@/domain/auth/expiry';
import { closedDaysText, openDaysText } from '@/domain/booking/opening-text';
import {
  customerInviteMessage,
  magicLinkMessage,
  resetPasswordMessage,
  verifyEmailMessage,
} from '@/infra/email/templates';

describe('open and closed days text follows the Owner’s setting', () => {
  it.each([
    [[1, 2, 3, 4, 5], 'Monday to Friday', 'Weekends and bank holidays are closed.'],
    [[1, 2, 3, 4, 5, 6], 'Monday to Saturday', 'Sundays and bank holidays are closed.'],
    [[2, 3, 4, 5, 6], 'Tuesday to Saturday', 'Mondays, Sundays and bank holidays are closed.'],
    [
      [1, 3, 5],
      'Monday, Wednesday and Friday',
      'Tuesdays, Thursdays, Saturdays, Sundays and bank holidays are closed.',
    ],
    [[1, 2, 3, 4, 5, 6, 7], 'Monday to Sunday', 'Bank holidays are closed.'],
  ])('open %j', (days, open, closed) => {
    expect(openDaysText(days)).toBe(open);
    expect(closedDaysText(days)).toBe(closed);
  });
  it('never calls an opened day closed, and handles odd input', () => {
    expect(closedDaysText([1, 2, 3, 4, 5, 6])).not.toContain('Saturday');
    expect(closedDaysText([1, 2, 3, 4, 5, 6])).not.toContain('Weekends');
    expect(openDaysText([])).toBe('');
    expect(openDaysText([5, 1, 1, 9, 0])).toBe('Monday and Friday');
  });
});

describe('expiry words come from one place and match the emails', () => {
  it('singular and plural', () => {
    expect([minutesText(1), minutesText(10), hoursText(1), hoursText(2), daysText(1), daysText(7)]).toEqual([
      '1 minute',
      '10 minutes',
      '1 hour',
      '2 hours',
      '1 day',
      '7 days',
    ]);
  });
  it('the emails say what the constants say', () => {
    const f = 'Alice';
    expect(verifyEmailMessage('a@x.test', f, 'https://u').text).toContain(
      `expires in ${hoursText(VERIFY_EMAIL_HOURS)}`,
    );
    expect(resetPasswordMessage('a@x.test', f, 'https://u').text).toContain(
      `expires in ${hoursText(RESET_PASSWORD_HOURS)}`,
    );
    expect(magicLinkMessage('a@x.test', f, 'https://u', MAGIC_LINK_MINUTES).text).toContain(
      `expires in ${minutesText(MAGIC_LINK_MINUTES)}`,
    );
    expect(magicLinkMessage('a@x.test', f, 'https://u', 25).html).toContain('expires in 25 minutes');
    expect(customerInviteMessage('a@x.test', f, 'Olive', null, 'https://u', []).text).toContain(
      `expires in ${daysText(INVITE_DAYS)}`,
    );
  });
  it('the auth configuration and invite expiry are built from the same constants', () => {
    const auth = readFileSync('src/infra/auth/auth.ts', 'utf8');
    expect(auth).toContain('RESET_PASSWORD_HOURS * 60 * 60');
    expect(auth).toContain('VERIFY_EMAIL_HOURS * 60 * 60');
    expect(auth).toContain('MAGIC_LINK_MINUTES * 60');
    expect(readFileSync('src/server/services/membership-workflow.ts', 'utf8')).toContain('INVITE_DAYS * 86_400_000');
  });
});
