# Customer-facing copy audit

Author: Researcher agent, 13 Nov 2026. Audited against `origin/main` at commit 34aca30. **No code was edited.** Scope: the public home page, sign-in, the customer account pages (`src/app/account`), the shared wording and timeline text (`src/domain/booking`), and the customer emails (`src/infra/email/templates.ts`). Checked against `docs/decisions.md`: D8, D11, D18, D20, D33, D39, D56, D58, D73, D76, D78, D79, D80, D81, D91, D96, D99, D100, D101, D106, D108.

**Method and limits.** I read the strings in code and searched for: spaces-left wording, promises, "book/booking" where it is a request, morning/afternoon wording, US spellings and apostrophes. I did not read every string on every page: I did not audit admin screens (not customer-facing), the full FAQ answers (in `src/domain` FAQ data), the terms page text, or every email in `membership-emails.ts`. Severity: **High** breaks an approved decision or promises something we can't keep; **Medium** is inconsistent or misleading; **Low** is tone or tidiness.

Line numbers are for the commit above and will drift.

## 1. Findings

### High

| # | File:line | What it says | Problem | Suggested direction |
|---|---|---|---|---|
| H1 | `src/domain/booking/rules.ts:93` (`SESSION_LABELS`), used at `src/app/account/bookings/page.tsx:242,256,312`, `bookings/[bookingId]/move/page.tsx:32`, `.../leave/page.tsx:29`, `.../cancel/page.tsx:29`, `account/membership/page.tsx:38-39`, `src/ui/day-picker.tsx:38-39` | "Morning", "Afternoon", a "Session" column, "sessions" | D100 removes half days everywhere, including for customers. Customers can still see "Morning/Afternoon" for any old half-day booking, a "Session" column header, and `day-picker.tsx` still offers the options. | Drop the Session column and labels for full-day-only data; show "Full day". Keep labels only for historic half-day rows if D100's open question keeps them honoured (Owner to confirm). |
| H2 | `src/domain/booking/overview.ts:95` | Confirmed: "You're booked. Cancel at least N hours ahead for a full refund." | Applies to every confirmed day, but a member day cancelled early is a **refund request the Owner approves** (D18, D56, D106), and membership days are paid on the monthly invoice, not at booking. "Full refund" is a promise for member days that is not automatic. | Use two lines: ad hoc: "...for a full refund to your card"; member: "...you can ask for a refund, which we review". The code already has `kind === 'membership'` data to choose. |
| H3 | `src/domain/booking/overview.ts:99` | Waitlist: "We'll email you if a place opens up." | D81: the waitlist is manual; "Nothing happens automatically" and the Owner gives a place by hand. The line promises an email whenever a place opens. | "If we can give you a place, we'll email you a link to pay." (matches D82: a given place becomes a day with a pay link) or "We'll get in touch if we can offer you a place." Needs Owner confirmation that an email is always sent on Give place. |
| H4 | `src/app/account/bookings/page.tsx:221` and `src/app/account/actions.ts:210`; `src/infra/email/templates.ts:602` | "Thanks – we'll check there's space and confirm. Your day stays booked until then." | "Your day stays booked until then" contradicts D76/D80 for request flows (not secured until approved and paid) and for moves it may be fine but reads like a promise; "check there's space" hints at capacity (not a count, so not a D101 breach, but see M3). | For moves: "Thanks – we'll look at your request and reply. Your current day stays as it is until then." For membership days: "...we'll check and confirm." |

### Medium

| # | File:line | What it says | Problem | Suggested direction |
|---|---|---|---|---|
| M1 | `src/app/page.tsx:48,58`, `src/app/not-found.tsx:31`, `src/app/access-denied/page.tsx:29`, `src/app/account/book/page.tsx:13,46`, `src/app/account/bookings/page.tsx:74`, `src/app/account/book/review/page.tsx:71`, `src/app/account/layout.tsx:63` ("Book a day") | "Book day care", "Book a day" | Every customer booking is a request (D76). The home search card and the Book page button already say "Request a day" / "Send booking request", so the mix is inconsistent and "Book day care" implies an instant booking. | Use "Request a day" for the button and link text; keep "Book" only for the Owner area and for already-secured days. Needs an Owner choice (wording is Owner-approved for D108 variants only). |
| M2 | `src/infra/email/templates.ts:355-360` | Title "Please pay to confirm your booking"; body "...pay ... to confirm it" | D80 fixes the approval email wording as "pay to secure your booking". This other pay-link email (Owner-booked days or a given waitlist place, D59, D82) uses "confirm" instead. | Align to "secure" across all pay-link emails, unless Stephen wants a different phrase for Owner-created bookings. |
| M3 | `src/app/account/book/review/page.tsx:64` | Outcome badge: "Place available – will be requested" | Fine under D101 (no count), but "Place available" can read as a promise. D76: a request holds a place, yet it still needs approval. | "Available – we'll send your request" or simply "Available". |
| M4 | `src/domain/booking/overview.ts:77` | Requested: "Luna's K9 Club will reply soon." | "Soon" is a vague promise. D79: requests have no timer and unanswered ones simply close at 23:59 the day before. | "We'll look at your request and reply by email." Or add the closing rule: "If we haven't replied before bookings close, it closes at no charge." |
| M5 | `src/infra/email/templates.ts:175` | "We'll email you when we've looked at it." | Same as M4; also in the request-received email. D79 says there is a closing email, so an email is sent either way. Mostly accurate. | Keep, but align with the on-screen text. |
| M6 | `src/app/account/bookings/page.tsx:131,147`; `src/infra/email/templates.ts:375` | "You can book again" | Customers request, they do not book directly (D76). Same issue as M1. | "You can send a new request." |
| M7 | `src/infra/email/templates.ts:436` | Booking reminder: "Need to change something? Please call us." | Customers can cancel or move in the portal (D39); the link is in the email. "Call us" is also not a published number in the email. | "To change or cancel, sign in here:" plus the link, then "or call us" only if a phone number is shown. |
| M8 | `src/infra/email/templates.ts:414` | Vaccination reminder: "...so we can't accept bookings after that date until a new record is uploaded." | True for core and leptospirosis (D73); D11 says only kennel cough can be overridden by the Owner. The email does not name which vaccination (D33, good), so the absolute claim can overreach for kennel cough. | Soften: "...so we may not be able to accept bookings after that date until a new record is uploaded." Owner choice. |
| M9 | `src/app/account/book/page.tsx:48` | "Members: extra days are booked here and charged at your membership day rate." | Extra days are requested and paid after approval (D17 amended by D76). "Booked" and "charged" skip the approval step. | "Members: you can request extra days here at your membership day rate." |

### Low

| # | File:line | Note |
|---|---|---|
| L1 | `src/app/account/book/page.tsx:18` | Code comment cites D100 for the "nearly full reads as Available" rule; the rule is D101. Not customer-facing, but easy to correct. Also `nearly_full` could be removed if the calendar no longer produces it. |
| L2 | `src/app/account/book/review/page.tsx:119-121` | "Cancel N hours or more before the session starts for a full refund to your card; later cancellations and no-shows are charged in full." The approved wording is "at least N hours before" (the home page uses it). Use the same phrase everywhere, and replace "session" with "day" (D100). |
| L3 | `src/app/account/bookings/page.tsx:166` | "Day care for {dogs} ({n} sessions)". Use "days" (D100). |
| L4 | `src/app/account/bookings/[bookingId]/cancel/page.tsx:40` | "...less than N hours before the session starts, so there's no refund." Use "before the day starts". For member days it should say there is no refund (correct by D18/D56). |
| L5 | `src/infra/email/templates.ts:550` | "We're sorry we couldn't answer your request in time" admits fault. D79 treats closure as a normal outcome. Consider "It wasn't approved before bookings closed for that day, so it has closed and nothing has been charged." (the on-screen text at `overview.ts` already says this). |
| L6 | `src/app/account/layout.tsx:63` | Header CTA "Book a day" vs home "Request a day" (see M1). |

## 2. Checked and fine (no change needed)

- The D76 request notice and the D80 approval wording come from one source, `src/domain/booking/wording.ts`, and are used on the form, after sending and in the email (checked in `book/page.tsx:53`, `bookings/page.tsx:84`, `templates.ts:175,347`).
- The calendar shows only Available, Full – join the waitlist, or Closed (`book/page.tsx:17-21`); no counts anywhere on the pages I read (D101). The home page text matches the Owner-approved variants from the wording options (D108): "No payment until Luna's K9 Club approves. You can withdraw a request any time. Once booked, cancel free at least N hours before; after that the day is charged." and the four first-day steps and the vaccination checklist.
- Decline and withdrawal wording says "nothing has been charged" (`templates.ts:542,546`) and does not give the Owner's note (D80, D91).
- Sign-in: the magic link is the default with "Sign in with a password instead" as the secondary, as D99 intends (`sign-in-form.tsx:28-31,45`).
- Sensitive data: the reminder, review and incident emails name the dog and say "sign in" rather than listing medical or behavioural details (D33, D62). The vaccination reminder names the dog but not which vaccination.
- UK English and apostrophes: I found no US spellings and the strings I read use curly apostrophes. Dates use en-GB.

## 3. Items that need an Owner decision

1. Whether customer links and buttons should say "Request a day" everywhere (M1, M6, L6).
2. What happens to existing half-day bookings in customer views (H1, D100's open question).
3. The exact waitlist line, and whether an email is always sent when a place is given (H3).
4. A separate sentence for member refunds (H2).
5. Whether the pay-link email for Owner-created bookings should say "secure" (M2).

## 4. Not covered

Admin screens, the FAQ answers, terms and privacy text, the membership emails in `membership-emails.ts`, error messages produced inside server actions, and any copy that only appears in tests. Suggested follow-up: a second pass of `src/domain` FAQ data and `membership-emails.ts`.
