import type { EmailMessage } from './types';
import type { FaqItem } from '../../domain/membership/faq';

import { APPROVED_PAY_TO_SECURE, REQUEST_NOT_SECURED } from '@/domain/booking/wording';

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

export function magicLinkMessage(to: string, firstName: string, url: string, minutes: number): EmailMessage {
  const title = 'Your sign-in link';
  return {
    to,
    template: 'auth.magic-link',
    subject: `${BRAND}: your sign-in link`,
    text: `Hi ${firstName},\n\nUse this link to sign in to your ${BRAND} account:\n${url}\n\nIt works once and expires in ${minutes} minutes.`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>Use the button below to sign in. It works once and expires in ${minutes} minutes.</p>${button(url, 'Sign in')}`,
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

/** Sent when a customer sends a booking request (D76). Uses the agreed wording, no notes. */
export function bookingRequestedMessage(to: string, firstName: string, ls: BookingLine[], url: string): EmailMessage {
  const l = lines(ls);
  return {
    to,
    template: 'booking.requested',
    subject: `${BRAND}: we’ve received your booking request`,
    text: `Hi ${firstName},\n\nThank you – we’ve received your booking request:\n${l.text}\n\n${REQUEST_NOT_SECURED}\n\nWe’ll email you when we’ve looked at it. You can see or withdraw your request here:\n${url}`,
    html: layout(
      'We’ve received your booking request',
      `<p>Hi ${escapeHtml(firstName)},</p><p>Thank you – we’ve received your booking request:</p>${l.html}<p><strong>${escapeHtml(REQUEST_NOT_SECURED)}</strong></p><p>We’ll email you when we’ve looked at it.</p>${button(url, 'See your bookings')}`,
    ),
  };
}

// Invoices (D24, D25). Invoice number, amount and due date only; details stay in the portal.
export type InvoiceSummary = { number: string; amountText: string; dueText: string; periodText: string };

/** Membership invoices also ask the customer to confirm the month's days (D88) and carry the FAQ (D91). */
export type InvoiceMembershipExtras = {
  confirm?: { monthText: string; byText: string; url: string };
  faqs?: FaqItem[];
};

export function invoiceIssuedMessage(
  to: string,
  firstName: string,
  inv: InvoiceSummary,
  url: string,
  extras: InvoiceMembershipExtras = {},
): EmailMessage {
  const title = `Invoice ${inv.number}`;
  const c = extras.confirm;
  const confirmText = c
    ? `\n\nPlease confirm your days for ${c.monthText} by ${c.byText}. If we don’t hear from you, your days stay as they are and the invoice is still due.\nConfirm your days: ${c.url}`
    : '';
  const confirmHtml = c
    ? `<p>Please confirm your days for ${escapeHtml(c.monthText)} by ${escapeHtml(c.byText)}. If we don’t hear from you, your days stay as they are and the invoice is still due.</p>${button(c.url, 'Confirm your days')}`
    : '';
  return {
    to,
    template: 'invoice.issued',
    subject: `${BRAND}: invoice ${inv.number} for ${inv.periodText}`,
    text: `Hi ${firstName},\n\nYour invoice ${inv.number} for ${inv.periodText} is ready. Amount: ${inv.amountText}. Please pay by ${inv.dueText}.\n\nSee the invoice here:\n${url}${confirmText}${extras.faqs ? faqText(extras.faqs) : ''}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>Your invoice for ${escapeHtml(inv.periodText)} is ready.</p><p><strong>Amount:</strong> ${escapeHtml(inv.amountText)}<br><strong>Please pay by:</strong> ${escapeHtml(inv.dueText)}</p>${button(url, 'See your invoice')}${confirmHtml}${extras.faqs ? faqHtml(extras.faqs) : ''}`,
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

type ConfirmationLine = { name: string; dogs: string[]; byOwner?: boolean };

/**
 * Owner's monthly confirmation summary (D88, D92, D94): who has confirmed (on time or late) and who
 * hasn't, by customer and dog. Customer and dog names only – nothing else about them (D33).
 */
export function ownerConfirmationSummaryMessage(
  to: string,
  s: {
    monthText: string;
    byText: string;
    unconfirmed: ConfirmationLine[];
    late: ConfirmationLine[];
    confirmed: ConfirmationLine[];
  },
  url: string,
): EmailMessage {
  const line = (l: ConfirmationLine) => `${l.name}: ${l.dogs.join(', ')}${l.byOwner ? ' (confirmed by you)' : ''}`;
  const sections = [
    { title: `Not confirmed (${s.unconfirmed.length}) – their days are kept as booked`, rows: s.unconfirmed },
    { title: `Confirmed late, after ${s.byText} (${s.late.length})`, rows: s.late },
    { title: `Confirmed (${s.confirmed.length})`, rows: s.confirmed },
  ].filter((x) => x.rows.length);
  const title = `Membership confirmations for ${s.monthText}`;
  const intro = `Members were asked to confirm their days for ${s.monthText} by ${s.byText}. Members who joined during ${s.monthText} aren’t included: their joining invoice covers it.`;
  const subjectTail = s.unconfirmed.length ? ` – ${s.unconfirmed.length} not confirmed` : ' – all confirmed';
  return {
    to,
    template: 'owner.membership-confirmations',
    subject: `${BRAND}: membership confirmations for ${s.monthText}${subjectTail}`,
    text: `${intro}\n\n${sections.map((x) => `${x.title}:\n${x.rows.map((r) => `- ${line(r)}`).join('\n')}`).join('\n\n')}\n\nYou can confirm for a member from their customer page:\n${url}`,
    html: layout(
      title,
      `<p>${escapeHtml(intro)}</p>${sections
        .map(
          (x) =>
            `<h2>${escapeHtml(x.title)}</h2><ul>${x.rows.map((r) => `<li>${escapeHtml(line(r))}</li>`).join('')}</ul>`,
        )
        .join('')}<p>You can confirm for a member from their customer page.</p>${button(url, 'Open the dashboard')}`,
      '',
    ),
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
  p: { amountText: string; forText: string; untilText: string; approved?: boolean },
  url: string,
): EmailMessage {
  // A booking request the Owner approved (D80): agreed "pay to secure" wording, link and London deadline.
  if (p.approved) {
    const t = 'Request approved – please pay to secure your booking';
    return {
      to,
      template: 'booking.request-approved',
      subject: `${BRAND}: request approved – please pay to secure your booking`,
      text: `Hi ${firstName},\n\n${APPROVED_PAY_TO_SECURE}\n\nWe're holding ${p.forText} for you. Please pay ${p.amountText} by card by ${p.untilText} (UK time). If it isn't paid by then, the place is released.\n\nPay here:\n${url}`,
      html: layout(
        t,
        `<p>Hi ${escapeHtml(firstName)},</p><p><strong>${escapeHtml(APPROVED_PAY_TO_SECURE)}</strong></p><p>We're holding ${escapeHtml(p.forText)} for you. Please pay <strong>${escapeHtml(p.amountText)}</strong> by card by <strong>${escapeHtml(p.untilText)}</strong> (UK time). If it isn't paid by then, the place is released.</p>${button(url, 'Pay by card')}<p>Or copy this link: ${escapeHtml(url)}</p>`,
        '',
      ),
    };
  }
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

// Compliance and welfare (Phase 7). Like all emails: no health, behaviour or incident details –
// just enough to prompt the customer to sign in (D33).
export function vaccinationReminderMessage(
  to: string,
  firstName: string,
  p: { dogName: string; expired: boolean; dateText: string },
  url: string,
): EmailMessage {
  const title = p.expired ? `${p.dogName}'s records need updating` : `Please update ${p.dogName}'s records`;
  const body = p.expired
    ? `A vaccination record for ${p.dogName} expired on ${p.dateText}, so we can't accept bookings after that date until a new record is uploaded.`
    : `A vaccination record for ${p.dogName} runs out on ${p.dateText}. Please upload the new record before then so ${p.dogName} can keep coming to day care.`;
  return {
    to,
    template: p.expired ? 'compliance.vaccination-expired' : 'compliance.vaccination-reminder',
    // Never lowercase the dog's name (it can start the title).
    subject: `${BRAND}: ${p.expired ? title : `please update ${p.dogName}'s records`}`,
    text: `Hi ${firstName},\n\n${body} Sign in to see which record:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(body)}</p>${button(url, 'Update records')}`,
      '',
    ),
  };
}

export function bookingReminderMessage(to: string, firstName: string, ls: BookingLine[], url: string): EmailMessage {
  const l = lines(ls);
  return {
    to,
    template: 'booking.reminder',
    subject: `${BRAND}: see you tomorrow`,
    text: `Hi ${firstName},\n\nA reminder of tomorrow's day care:\n${l.text}\n\nNeed to change something? Please call us.\n${url}`,
    html: layout(
      'See you tomorrow',
      `<p>Hi ${escapeHtml(firstName)},</p><p>A reminder of tomorrow's day care:</p>${l.html}<p>Need to change something? Please call us.</p>${button(url, 'See your bookings')}`,
      '',
    ),
  };
}

export function incidentMessage(
  to: string,
  firstName: string,
  /** dayText: "today" or "on 12 October 2026" – the day it happened, which may be before today. */
  p: { dogName: string; update: boolean; dayText?: string },
  url: string,
): EmailMessage {
  const title = p.update
    ? `An update about ${p.dogName}`
    : `Something happened at day care ${p.dayText ?? 'today'} – ${p.dogName}`;
  const body = p.update
    ? `We've added an update to an incident report about ${p.dogName}.`
    : `We've written an incident report about ${p.dogName} so you know exactly what happened and what we did.`;
  return {
    to,
    template: p.update ? 'welfare.incident-update' : 'welfare.incident',
    subject: `${BRAND}: ${title}`,
    text: `Hi ${firstName},\n\n${body} Please sign in to read it. If you have any questions, just call us.\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(body)} Please sign in to read it. If you have any questions, just call us.</p>${button(url, 'Read the report')}`,
      '',
    ),
  };
}

/** dayText: "today" or "on 12 October 2026" – the day of the check, which may be before today. */
export function welfareNoteMessage(
  to: string,
  firstName: string,
  dogName: string,
  dayText: string,
  url: string,
): EmailMessage {
  const title = `A note about ${dogName} ${dayText}`;
  return {
    to,
    template: 'welfare.note',
    subject: `${BRAND}: a note about ${dogName} ${dayText}`,
    text: `Hi ${firstName},\n\nWe noticed something about ${dogName} ${dayText} that we'd like you to know about. Please sign in to read our note:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>We noticed something about ${escapeHtml(dogName)} ${escapeHtml(dayText)} that we'd like you to know about.</p>${button(url, 'Read the note')}`,
      '',
    ),
  };
}

export function erasureDecisionMessage(
  to: string,
  firstName: string,
  p: { approved: boolean; retainUntilText: string | null; reason: string | null },
): EmailMessage {
  const title = p.approved ? 'Your account has been closed' : 'About your request to delete your account';
  const body = p.approved
    ? p.retainUntilText
      ? `We've closed your account and you can no longer sign in. The law requires us to keep some records (your dog's day care register and invoices) for a set time; we'll delete or anonymise them by ${p.retainUntilText}, and we won't use them for anything else.`
      : `We've closed your account and removed your personal details. Invoices are kept for 6 years as the law requires.`
    : `We couldn't close your account yet. ${p.reason ?? ''}`.trim();
  return {
    to,
    template: p.approved ? 'data.erasure-approved' : 'data.erasure-declined',
    subject: `${BRAND}: ${title.toLowerCase()}`,
    text: `Hi ${firstName},\n\n${body}`,
    html: layout(title, `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(body)}</p>`, ''),
  };
}

// Approval requests (D77). Polite standard wording only: the summary comes from the request type's
// describe() (never sensitive), and the Owner's note is never included – the customer reads it in the portal.
export function approvalRequestedOwnerMessage(to: string, p: { label: string }, url: string): EmailMessage {
  const title = `New ${p.label.toLowerCase()} to review`;
  return {
    to,
    template: 'approval.owner-new',
    subject: `${BRAND}: ${title.toLowerCase()}`,
    text: `A customer has sent a ${p.label.toLowerCase()}. Review it here:\n${url}`,
    html: layout(
      title,
      `<p>A customer has sent a ${escapeHtml(p.label.toLowerCase())}.</p>${button(url, 'Review requests')}`,
      '',
    ),
  };
}

export type ApprovalOutcome = 'approved' | 'rejected' | 'withdrawn' | 'expired';

const APPROVAL_COPY: Record<ApprovalOutcome, { title: (label: string) => string; body: string }> = {
  approved: {
    title: (l) => `Your ${l} has been approved`,
    body: 'Good news – we’ve approved your request.',
  },
  rejected: {
    title: (l) => `About your ${l}`,
    body: 'Thank you for your request. Unfortunately we can’t accept it this time, and nothing has been charged. Please sign in to see more, or get in touch if you have any questions.',
  },
  withdrawn: {
    title: (l) => `Your ${l} has been withdrawn`,
    body: 'As you asked, we’ve withdrawn your request. Nothing has been charged.',
  },
  expired: {
    title: (l) => `Your ${l} is no longer open`,
    body: 'We’re sorry we couldn’t answer your request in time, so it has closed and nothing has been charged. You’re welcome to send a new one.',
  },
};

export function approvalDecisionMessage(
  to: string,
  firstName: string,
  p: { label: string; summary: string; outcome: ApprovalOutcome },
  url: string,
): EmailMessage {
  const copy = APPROVAL_COPY[p.outcome];
  const title = copy.title(p.label.toLowerCase());
  return {
    to,
    template: `approval.${p.outcome}`,
    subject: `${BRAND}: ${title.charAt(0).toLowerCase()}${title.slice(1)}`,
    text: `Hi ${firstName},\n\n${copy.body}\n\n${p.summary}\n\nSee the details in your account:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(copy.body)}</p><p>${escapeHtml(p.summary)}</p>${button(url, 'See the details')}`,
      '',
    ),
  };
}

// ---- Membership workflow (D86–D91). Names, dog names, weekdays and dates only (D33). ----------

function faqText(faqs: FaqItem[]): string {
  return `\n\nQuick answers\n${faqs.map((f) => `\n${f.question}\n${f.answer}`).join('\n')}`;
}

function faqHtml(faqs: FaqItem[]): string {
  return `<h2 style="font-size:16px;margin:24px 0 8px">Quick answers</h2>${faqs
    .map((f) => `<p><strong>${escapeHtml(f.question)}</strong><br>${escapeHtml(f.answer)}</p>`)
    .join('')}`;
}

/** The days the Owner set at account creation, already described (e.g. "Bella: Mon, Wed – full day, from 2 Nov 2026"). */
export type InviteDays = string[];

/** "Finish signing up" invite with the fixed cover note (D87). No free text from the Owner. */
export function customerInviteMessage(
  to: string,
  firstName: string,
  ownerFirstName: string,
  days: InviteDays | null,
  url: string,
  faqs: FaqItem[],
): EmailMessage {
  const title = 'Finish setting up your account';
  const cover = days?.length
    ? `We’ve set up your membership with these days:\n${days.map((d) => `- ${d}`).join('\n')}\n\nPlease check and confirm them when you finish setting up. You can change them – any change comes to us to approve.`
    : 'Please choose your regular days while you finish setting up. Any days you choose come to us to approve, and we’ll confirm once we’ve checked there’s space.';
  const coverHtml = days?.length
    ? `<p>We’ve set up your membership with these days:</p><ul>${days.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul><p>Please check and confirm them when you finish setting up. You can change them – any change comes to us to approve.</p>`
    : `<p>Please choose your regular days while you finish setting up. Any days you choose come to us to approve, and we’ll confirm once we’ve checked there’s space.</p>`;
  return {
    to,
    template: 'customer.invite',
    subject: `${BRAND}: finish setting up your account`,
    text: `Hi ${firstName},\n\n${ownerFirstName} at ${BRAND} has created an account for you.\n\n${cover}\n\nFinish setting up (choose a password): ${url}\n\nThis link works once and expires in 7 days.${faqText(faqs)}\n\nThanks,\n${ownerFirstName}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>${escapeHtml(ownerFirstName)} at ${BRAND} has created an account for you.</p>${coverHtml}${button(url, 'Finish setting up')}<p style="font-size:13px;color:#4f5660">This link works once and expires in 7 days.</p>${faqHtml(faqs)}<p>Thanks,<br>${escapeHtml(ownerFirstName)}</p>`,
      "If you weren't expecting this, you can ignore this email.",
    ),
  };
}

/** The Owner changed a dog's regular days (D89). */
export function membershipDaysChangedMessage(
  to: string,
  firstName: string,
  dogName: string,
  daysText: string,
  fromText: string,
  url: string,
): EmailMessage {
  const title = `${dogName}’s days have changed`;
  return {
    to,
    template: 'membership.days-changed',
    subject: `${BRAND}: ${dogName}’s regular days have changed`,
    text: `Hi ${firstName},\n\nWe’ve changed ${dogName}’s regular days to ${daysText}, from ${fromText}. Your bookings have been updated:\n${url}`,
    html: layout(
      title,
      `<p>Hi ${escapeHtml(firstName)},</p><p>We’ve changed ${escapeHtml(dogName)}’s regular days to ${escapeHtml(daysText)}, from ${escapeHtml(fromText)}. Your bookings have been updated.</p>${button(url, 'See your bookings')}`,
      '',
    ),
  };
}
