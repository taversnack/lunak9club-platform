/**
 * How long each emailed link or session lasts, in one place. The auth configuration, the emails and the
 * pages that say "this link lasts…" all read these, so the words can never drift from what the server does.
 */
export const MAGIC_LINK_MINUTES = 10;
export const VERIFY_EMAIL_HOURS = 1;
export const RESET_PASSWORD_HOURS = 1;
export const INVITE_DAYS = 7;
export const SESSION_DAYS = 7;

export const minutesText = (m: number): string => (m === 1 ? '1 minute' : `${m} minutes`);
export const hoursText = (h: number): string => (h === 1 ? '1 hour' : `${h} hours`);
export const daysText = (d: number): string => (d === 1 ? '1 day' : `${d} days`);
