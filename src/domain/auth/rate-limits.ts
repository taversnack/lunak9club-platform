/**
 * Magic-link request limits, shared by the server (better-auth rules and the per-address limit) and
 * the sign-in form's "please wait" copy, so the copy always matches the configured window.
 */
export const MAGIC_LINK_WINDOW_SECONDS = 300;
/** Requests allowed per window, both per client IP and per email address. */
export const MAGIC_LINK_MAX = 3;

/** "a minute", "5 minutes", "30 seconds": how long a window lasts, for "Please wait … and try again." */
export function waitFor(seconds: number): string {
  if (seconds <= 60) return seconds === 60 ? 'a minute' : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minutes`;
}

export const rateLimitedCopy = (seconds: number) => `Too many requests. Please wait ${waitFor(seconds)} and try again.`;

/**
 * Password-reset and verification-email requests are limited per client address by better-auth and, so that
 * many addresses can't be used to flood one person's inbox, also per email address: this many per window across
 * every client. The same numbers as the per-address limit above and the per-client rule.
 */
export const EMAIL_REQUEST_WINDOW_SECONDS = 300;
export const EMAIL_REQUEST_MAX = 3;
