# Wording for Stephen to decide

Author: Researcher agent, 15 Nov 2026. These are customer-facing sentences that exist in code (or open pull requests) but are **not** in the Owner-approved wording (D76, D80, D108, D117). Each has the current text, where it is, and one or two options. **Options are suggestions; nothing changes until you choose.** Line numbers are from `main` on 15 Nov 2026 or from the named open PR, and will drift.

Rules every option keeps: no promise we can't keep, no spaces left (D101), full days only (D100), requests are not bookings until approved and paid (D76, D80), no apology for a normal closure (D79, D117), no health or behaviour detail in emails (D33).

## 1. Taxi-day reminder line (still open in D117)

- **Current text:** "with taxi – we'll confirm collection times this evening" (shown beside a taxi day in the booking reminder).
- **File:** `src/server/services/reminders.ts:144`.
- **Why it needs a decision:** D117 lists this as "still to be decided". It promises something happens "this evening". D26 says collection and drop-off times are fixed the evening before and customers are told when the run sheet is published.
- **Option A:** keep it: "with taxi – we'll confirm collection times this evening". Accurate only if the run sheet is always published that evening.
- **Option B:** "with taxi – we'll let you know your collection time once the taxi run is planned". Makes no promise about when.

## 2. Closed-request email: the "not answered in time" sentence (PR #173)

- **Current text:** "This request wasn't answered in time, so it has closed at no charge. You can send a new one."
- **File:** `src/infra/email/templates.ts` (in PR #173, the expired-request copy). It is the fallback used for requests that expired for any reason other than the 23:59 cut-off.
- **Why:** D117 approves only the cut-off wording. "Wasn't answered in time" can read as blaming the Owner for a slow reply.
- **Option A:** keep as is.
- **Option B (neutral, matches the approved sentence):** "This request has closed at no charge. You can send a new request for another day." Shorter, no cause given.

## 3. Booking summary partial-close line (PR #173)

- **Current text:** the outcome line "not approved before booking closed at 23:59 the day before – closed at no charge" in the booking request summary.
- **File:** `src/infra/email/templates.ts` and the request summary code in `src/server/services/booking-requests.ts` (PR #173).
- **Why:** D117 approves the full closed-request email, not this shortened per-day line used inside a summary of several days.
- **Option A:** keep it as is (consistent with the approved sentence).
- **Option B:** "closed at no charge – not approved before booking closed at 23:59 the day before". Puts the reassurance first.

## 4. Confirmed-day lines on the overview (PR #174)

D117(3) approves the member-day refund line only. These three siblings are new:
- **Ad hoc, 48 hours or more ahead.** Current: "You're booked. Cancel at least N hours ahead and the day is refunded to your card."
- **Within the notice period.** Current: "You're booked. It's less than N hours until it starts, so cancelling now is still charged."
- **Fallback when the type is unknown.** Current: "You're booked. Cancelling at least N hours ahead is free; later than that it is charged."
- **File:** `src/domain/booking/overview.ts` (in PR #174).
- **Options for the first line:** A) keep ("...refunded to your card"). B) "You're booked. Cancel at least N hours ahead and we'll refund the day to your card." Both are consistent with D58 (ad hoc refunds go to the card automatically). Avoid promising a refund timeframe.
- **Options for the late line:** A) keep. B) "You're booked. Cancelling within N hours of the day is still charged."

## 5. Slot label on the review page (PR #170)

- **Current text:** "Available – will be requested".
- **File:** `src/app/account/book/review/page.tsx` (PR #170).
- **Why:** "Available" is allowed (D101), but "will be requested" is new wording and could read as if the request is already sent.
- **Option A:** keep.
- **Option B:** "Available – ready to request".

## 6. Refund and credit reasons that name the notice period (PR #175)

- **Current text:** "Cancelled N hours or more ahead: [dog]" and "Refund: [day] cancelled N hours or more ahead".
- **File:** refund and credit-note reason helpers (PR #175).
- **Why:** these appear in the Owner's refund screens and may appear on credit notes the customer sees. "N hours or more ahead" differs from the approved customer phrase "at least N hours before".
- **Option A:** keep (internal wording).
- **Option B:** align to "at least N hours before": "Cancelled at least N hours before: [dog]".

## 7. Other open items from the copy audit (PR #166)

I have not re-checked each against the latest merges; confirm with the current code before you decide.
- **"We'll look and reply soon"** on the requested-state timeline line. Suggestion: "We'll look at your request and reply by email." (D79: no timer on requests.)
- **Booking reminder: "Need to change something? Please call us."** Suggestion: "To change or cancel, sign in here:" with the link, and add "or call us" only if a phone number is shown.
- **Vaccination expiry email: "...we can't accept bookings after that date until a new record is uploaded."** True for core and leptospirosis; kennel cough can be overridden (D73). Suggestion: "...we may not be able to accept bookings after that date until a new record is uploaded."
- **"Members: extra days are booked here and charged at your membership day rate."** Suggestion: "Members: you can request extra days here at your membership day rate." (D17 amended by D76).

## 8. Already decided (for reference, no action)

D76 notice, D80 approval email, D108 reassurance line and first-day steps, D117 "Request a day", old half-day bookings, member refund line, closed-request email and the waitlist line "A place isn't guaranteed. If Luna's K9 Club gives you one, we'll email you."
