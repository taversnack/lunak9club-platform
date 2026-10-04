import type { EmailMessage } from './types';

const BRAND = 'Luna’s K9 Club';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(
  title: string,
  bodyHtml: string,
  footer = "If you didn't ask for this, you can ignore this email.",
): string {
  return `<!doctype html><html lang="en-GB"><body style="font-family:system-ui,sans-serif;background:#f7f5f2;color:#273039;padding:24px">
<div style="max-width:520px;margin:auto;background:#fff;border-top:4px solid #283039;padding:28px">
<p style="font-weight:700;color:#283039;letter-spacing:.04em;margin:0 0 16px">${BRAND}</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
${bodyHtml}
${footer ? `<p style="font-size:13px;color:#4f5660;margin-top:24px">${escapeHtml(footer)}</p>` : ''}
</div></body></html>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#dfc8ad;color:#273039;font-weight:700;padding:12px 20px;text-decoration:none">${escapeHtml(label)}</a></p>
<p style="font-size:13px;color:#4f5660">Or copy this link: ${escapeHtml(url)}</p>`;
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
    subject: `Luna’s K9 Club: an update is needed for ${dogName}`,
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
    subject: `Luna’s K9 Club: ${dogName} is approved for day care`,
    text: `Hi ${firstName},\n\nGreat news – ${dogName} is approved for day care at Luna’s K9 Club. Sign in to see your dog's page:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>Great news – ${escapeHtml(dogName)} is approved for day care at Luna’s K9 Club.</p>${button(url, 'Sign in')}`,
    ),
  };
}

export function ownerReviewWaitingMessage(to: string, url: string): EmailMessage {
  return {
    to,
    template: 'owner.review-waiting',
    subject: 'Luna’s K9 Club: new records to review',
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
    subject: 'Luna’s K9 Club: your booking',
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
    subject: 'Luna’s K9 Club: booking cancelled',
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
    subject: 'Luna’s K9 Club: a place is available',
    text: `Hi ${firstName},\n\nA place has come up:\n${l.text}\n\nWe'll hold it for ${hours} hours. Sign in to accept it:\n${url}`,
    html: layout(
      'A place is available',
      `<p>Hi ${escapeHtml(firstName)},</p><p>A place has come up:</p>${l.html}<p>We'll hold it for ${hours} hours.</p>${button(url, 'Accept the place')}`,
    ),
  };
}

// Invoices (D24, D25). Invoice number, amount and due date only; details stay in the portal.
export type InvoiceSummary = { number: string; amountText: string; dueText: string; periodText: string };

export function invoiceIssuedMessage(to: string, firstName: string, inv: InvoiceSummary, url: string): EmailMessage {
  const title = `Invoice ${inv.number}`;
  return {
    to,
    template: 'invoice.issued',
    subject: `${BRAND}: invoice ${inv.number} for ${inv.periodText}`,
    text: `Hi ${firstName},\n\nYour invoice ${inv.number} for ${inv.periodText} is ready. Amount: ${inv.amountText}. Please pay by ${inv.dueText}.\n\nSee the invoice here:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>Your invoice for ${escapeHtml(inv.periodText)} is ready.</p><p><strong>Amount:</strong> ${escapeHtml(inv.amountText)}<br><strong>Please pay by:</strong> ${escapeHtml(inv.dueText)}</p>${button(url, 'See your invoice')}`,
      '',
    ),
  };
}

export function paymentReminderMessage(to: string, firstName: string, inv: InvoiceSummary, url: string): EmailMessage {
  const title = `Reminder: invoice ${inv.number}`;
  return {
    to,
    template: 'invoice.reminder',
    subject: `${BRAND}: reminder – invoice ${inv.number} is due ${inv.dueText}`,
    text: `Hi ${firstName},\n\nA quick reminder that invoice ${inv.number} (${inv.amountText} still to pay) is due on ${inv.dueText}. If you've already paid, thank you – please ignore this.\n\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>A quick reminder that invoice ${escapeHtml(inv.number)} is due on ${escapeHtml(inv.dueText)}.</p><p><strong>Still to pay:</strong> ${escapeHtml(inv.amountText)}</p><p>If you've already paid, thank you – please ignore this.</p>${button(url, 'See your invoice')}`,
      '',
    ),
  };
}

export function refundDecisionMessage(
  to: string,
  firstName: string,
  d: { approved: boolean; dayText: string; amountText: string; reason?: string | null },
  url: string,
): EmailMessage {
  const title = d.approved ? 'Refund approved' : 'Refund not approved';
  const body = d.approved
    ? `We've approved a refund of ${d.amountText} for ${d.dayText}.`
    : `We couldn't approve a refund for ${d.dayText}.${d.reason ? ` Reason: ${d.reason}` : ''}`;
  return {
    to,
    template: d.approved ? 'refund.approved' : 'refund.declined',
    subject: `${BRAND}: ${title.toLowerCase()}`,
    text: `Hi ${firstName},\n\n${body}\n\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(body)}</p>${button(url, 'See your invoices')}`,
      '',
    ),
  };
}

export function ownerBillingMessage(to: string, subject: string, body: string, url: string): EmailMessage {
  return {
    to,
    template: 'owner.billing',
    subject: `${BRAND}: ${subject}`,
    text: `${body}\n\n${url}`,
    html: layout(subject, `<p>${escapeHtml(body)}</p>${button(url, 'Open invoices')}`, ''),
  };
}

// Card payments (D6, D59). Amounts and invoice numbers only – never card details.
export function paymentReceivedMessage(
  to: string,
  firstName: string,
  p: { amountText: string; forText: string; number: string | null },
  url: string,
): EmailMessage {
  const title = 'Payment received – thank you';
  const ref = p.number ? ` (invoice ${p.number})` : '';
  return {
    to,
    template: 'payment.received',
    subject: `${BRAND}: payment received${p.number ? ` – ${p.number}` : ''}`,
    text: `Hi ${firstName},\n\nWe've received your card payment of ${p.amountText} for ${p.forText}${ref}. Your receipt is in your account:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>We've received your card payment of <strong>${escapeHtml(p.amountText)}</strong> for ${escapeHtml(p.forText)}${escapeHtml(ref)}.</p>${button(url, 'See your receipt')}`,
      '',
    ),
  };
}

export function paymentLinkMessage(
  to: string,
  firstName: string,
  p: { amountText: string; forText: string; untilText: string },
  url: string,
): EmailMessage {
  const title = 'Please pay to confirm your booking';
  return {
    to,
    template: 'payment.link',
    subject: `${BRAND}: please pay to confirm your booking`,
    text: `Hi ${firstName},\n\nWe've held ${p.forText} for you. Please pay ${p.amountText} by card by ${p.untilText} to confirm it – after that the place is released.\n\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>We've held ${escapeHtml(p.forText)} for you. Please pay <strong>${escapeHtml(p.amountText)}</strong> by card by ${escapeHtml(p.untilText)} to confirm it. After that the place is released.</p>${button(url, 'Pay by card')}`,
      '',
    ),
  };
}

export function holdReleasedMessage(to: string, firstName: string, forText: string, url: string): EmailMessage {
  const title = 'Booking not completed';
  return {
    to,
    template: 'payment.hold-released',
    subject: `${BRAND}: booking not completed`,
    text: `Hi ${firstName},\n\nWe didn't receive payment in time for ${forText}, so the place has been released. You can book again here:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>We didn't receive payment in time for ${escapeHtml(forText)}, so the place has been released.</p>${button(url, 'Book again')}`,
      '',
    ),
  };
}

export function cardRefundMessage(
  to: string,
  firstName: string,
  p: { amountText: string; forText: string },
  url: string,
): EmailMessage {
  const title = 'Refund on its way';
  return {
    to,
    template: 'payment.refund',
    subject: `${BRAND}: refund of ${p.amountText}`,
    text: `Hi ${firstName},\n\nWe've refunded ${p.amountText} to your card for ${p.forText}. It usually appears within 5–10 working days.\n\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>We've refunded <strong>${escapeHtml(p.amountText)}</strong> to your card for ${escapeHtml(p.forText)}. It usually appears within 5–10 working days.</p>${button(url, 'See your invoices')}`,
      '',
    ),
  };
}
