import type { EmailMessage } from './types';

const BRAND = 'LunaK9 Club';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="en-GB"><body style="font-family:system-ui,sans-serif;background:#faf6f0;color:#2b2320;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border-radius:12px;padding:28px">
<p style="font-weight:700;color:#7a4a2a;margin:0 0 16px">${BRAND}</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
${bodyHtml}
<p style="font-size:13px;color:#6b5f58;margin-top:24px">If you didn't ask for this, you can ignore this email.</p>
</div></body></html>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#7a4a2a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:#6b5f58">Or copy this link: ${escapeHtml(url)}</p>`;
}

// Emails deliberately contain no sensitive details; the portal is the source of truth.
export function verifyEmailMessage(to: string, firstName: string, url: string): EmailMessage {
  const title = 'Confirm your email address';
  return {
    to,
    template: 'auth.verify-email',
    subject: `${BRAND}: confirm your email`,
    text: `Hi ${firstName},\n\nPlease confirm your email address to finish setting up your ${BRAND} account:\n${url}\n\nThis link expires in 1 hour.`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>Please confirm your email address to finish setting up your account. This link expires in 1 hour.</p>${button(url, 'Confirm email')}`,
    ),
  };
}

export function resetPasswordMessage(to: string, firstName: string, url: string): EmailMessage {
  const title = 'Reset your password';
  return {
    to,
    template: 'auth.reset-password',
    subject: `${BRAND}: reset your password`,
    text: `Hi ${firstName},\n\nUse this link to choose a new password:\n${url}\n\nThis link expires in 1 hour.`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>Use the button below to choose a new password. This link expires in 1 hour.</p>${button(url, 'Choose a new password')}`,
    ),
  };
}

// Compliance notifications — deliberately contain no health, behaviour or document details (D33).
export function recordNeedsAttentionMessage(to: string, firstName: string, dogName: string, url: string): EmailMessage {
  const title = `An update is needed for ${dogName}`;
  return {
    to,
    template: 'compliance.needs-attention',
    subject: `LunaK9 Club: an update is needed for ${dogName}`,
    text: `Hi ${firstName},\n\nWe've looked at the records you sent for ${dogName} and need something updated. Please sign in to see what's needed:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>We've looked at the records you sent for ${escapeHtml(dogName)} and need something updated. Please sign in to see what's needed.</p>${button(url, 'Sign in')}`,
    ),
  };
}

export function dogApprovedMessage(to: string, firstName: string, dogName: string, url: string): EmailMessage {
  const title = `${dogName} is approved`;
  return {
    to,
    template: 'compliance.dog-approved',
    subject: `LunaK9 Club: ${dogName} is approved for day care`,
    text: `Hi ${firstName},\n\nGreat news – ${dogName} is approved for day care at LunaK9 Club. Sign in to see your dog's page:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>Great news – ${escapeHtml(dogName)} is approved for day care at LunaK9 Club.</p>${button(url, 'Sign in')}`,
    ),
  };
}

export function ownerReviewWaitingMessage(to: string, url: string): EmailMessage {
  return {
    to,
    template: 'owner.review-waiting',
    subject: 'LunaK9 Club: new records to review',
    text: `A customer has sent new records to review:\n${url}`,
    html: layout(
      'New records to review',
      `<p>A customer has sent new records to review.</p>${button(url, 'Open reviews')}`,
    ),
  };
}

// Booking notifications (D35–D41). Dog names and dates only.
export type BookingLine = { dogName: string; dateText: string; sessionText: string; outcome: string };

function lines(ls: BookingLine[]) {
  return {
    text: ls.map((l) => `- ${l.dateText}, ${l.sessionText}: ${l.dogName} – ${l.outcome}`).join('\n'),
    html: `<ul>${ls.map((l) => `<li>${escapeHtml(l.dateText)}, ${escapeHtml(l.sessionText)}: ${escapeHtml(l.dogName)} – ${escapeHtml(l.outcome)}</li>`).join('')}</ul>`,
  };
}

export function bookingSummaryMessage(to: string, firstName: string, ls: BookingLine[], url: string): EmailMessage {
  const l = lines(ls);
  return {
    to,
    template: 'booking.summary',
    subject: 'LunaK9 Club: your booking',
    text: `Hi ${firstName},\n\nHere's a summary of your booking:\n${l.text}\n\nYou can see or cancel bookings here:\n${url}`,
    html: layout(
      'Your booking',
      `<p>Hi ${escapeHtml(firstName)},</p><p>Here's a summary of your booking:</p>${l.html}${button(url, 'See your bookings')}`,
    ),
  };
}

export function bookingCancelledMessage(to: string, firstName: string, line: BookingLine, url: string): EmailMessage {
  const l = lines([line]);
  return {
    to,
    template: 'booking.cancelled',
    subject: 'LunaK9 Club: booking cancelled',
    text: `Hi ${firstName},\n\nThis booking has been cancelled:\n${l.text}\n\n${url}`,
    html: layout(
      'Booking cancelled',
      `<p>Hi ${escapeHtml(firstName)},</p><p>This booking has been cancelled:</p>${l.html}${button(url, 'See your bookings')}`,
    ),
  };
}

export function waitlistOfferMessage(
  to: string,
  firstName: string,
  line: BookingLine,
  hours: number,
  url: string,
): EmailMessage {
  const l = lines([line]);
  return {
    to,
    template: 'booking.waitlist-offer',
    subject: 'LunaK9 Club: a place is available',
    text: `Hi ${firstName},\n\nA place has come up:\n${l.text}\n\nWe'll hold it for ${hours} hours. Sign in to accept it:\n${url}`,
    html: layout(
      'A place is available',
      `<p>Hi ${escapeHtml(firstName)},</p><p>A place has come up:</p>${l.html}<p>We'll hold it for ${hours} hours.</p>${button(url, 'Accept the place')}`,
    ),
  };
}
