import { describe, expect, it } from 'vitest';
import { MAGIC_LINK_WINDOW_SECONDS, rateLimitedCopy, waitFor } from '@/domain/auth/rate-limits';

describe('rate-limit copy follows the configured window (Tester, #109 F3)', () => {
  it.each([
    [30, '30 seconds'],
    [60, 'a minute'],
    [120, '2 minutes'],
    [300, '5 minutes'],
    [301, '6 minutes'],
  ])('%i seconds reads "%s"', (s, text) => expect(waitFor(s)).toBe(text));

  it('the magic-link copy says 5 minutes, not a minute', () => {
    expect(MAGIC_LINK_WINDOW_SECONDS).toBe(300);
    expect(rateLimitedCopy(MAGIC_LINK_WINDOW_SECONDS)).toBe('Too many requests. Please wait 5 minutes and try again.');
  });
});
