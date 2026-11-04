# Owner wording options for approval

Author: Researcher agent, 4 Nov 2026. **Drafts for Stephen to choose from. Not decisions.** Plain UK English. Nothing here is live until approved and recorded in `docs/decisions.md`.

Checked against D8, D39, D76, D79, D80, D91, D100, D101, D106, plus D10, D11, D18, D20, D56, D58, D73, D74, D78 where a line touches them. Rules kept in every line: no number or hint of places left (D101); full days only, so no "morning" or "afternoon" (D100); the Owner-confirmed D76 and D80 sentences are not rewritten; emails and standard text carry no decision notes (D91) and no dog health detail (D33).

Marker meanings: **[D#]** the line restates that decision. **[Check]** the line implies something not stated in `decisions.md`; Stephen should confirm it, or choose another variant.

---

## 1. Reassurance line under the Request button

The Owner-confirmed D76 sentence ("Please note: sending this request does not secure your booking...") must still appear on the form and after sending. These are short lines for under the button, in addition to it.

| Variant | Wording | Checks |
|---|---|---|
| A (shortest) | "Nothing to pay yet. Luna's K9 Club approves your request first, then you pay to secure your booking." | Matches D76 (no payment taken at request) and D80 (pay after approval). No capacity hint. |
| B (adds cancellation) | "No payment until Luna's K9 Club approves. You can withdraw a request any time. Once booked, cancel free up to 48 hours before; after that the day is charged." | D79 (withdraw any time, no charge), D8 and D39 (48 hours, then charged). "Once booked" matters: D39 applies to the session start. |
| C (reassuring, longer) | "This is a request, not a booking yet. We'll check it and reply, and you only pay once it's approved. Free to cancel up to 48 hours before your day." | D76, D80, D8. **[Check]** "We'll check it and reply" promises a reply; D79 says unanswered requests simply close at 23:59 the day before. Drop that clause if the Owner does not want to promise a reply. |

Recommended for approval (opinion): B, because it answers both fears (cost and cancelling) in two sentences. Avoid "guaranteed", "instant" or "confirmed" near the button.

---

## 2. "How your first day works" (four steps)

Order follows D10 (meet-and-greet, paid trial day, onboarding form). **[Check]** D10 lists these items but does not fix their order, and D85 (customer trial requests) is still Proposed on the "dogs not yet approved" rule. Confirm the order and whether onboarding is completed before or after the trial day.

**Variant 1 (short)**
1. Meet us. Come for a short meet-and-greet so we can say hello to you and your dog.
2. Try a day. Request a trial day. We approve it, then you pay to secure it.
3. Complete your dog's profile. Upload vaccination certificates, vet details, an emergency contact and accept the terms.
4. Book. Once your dog is approved, request the days you want.

**Variant 2 (friendlier, with a reassurance in each step)**
1. Say hello. A relaxed meet-and-greet, no rush.
2. A trial day. Your dog spends a day with us so we can see how they get on. It's one trial day per dog.
3. Tell us about your dog. Health, feeding and contact details, plus up-to-date vaccination certificates.
4. Request your days. We approve each request, then you pay to secure it.

Checks: D10, D76, D80. "One trial day per dog" is in the brief and was reported as implemented in D96; confirm D96 is recorded in `decisions.md` before publishing. Do not state the trial price in this block (D3, D21 and D85 differ by case; show the price from settings at request time).

---

## 3. Trust block: what Stephen must supply

Do not publish any item until Stephen provides it. I have not invented any of these.

| Fact | Needed from Stephen | Where to show |
|---|---|---|
| Council licence reference | The exact licence number and issuing council (the current site shows a licence reference in its footer: copy it exactly, do not paraphrase) | Footer and trust block |
| Company name | Registered name as it must appear (D51: Luna's K9 Club Ltd) and company number | Footer, invoices |
| Registered address | Registered office, and the premises address if different | Footer, contact page |
| Contact | Phone and email for customers | Footer, contact page |
| Insurance | Whether to mention insurance at all; if yes, the exact cover (for example business or public liability) and insurer-approved wording | Trust block (optional) |
| First aid | Whether staff hold a pet first-aid qualification; if yes, the name and level, and who holds it | Trust block (optional) |
| Vaccination requirements | Confirm the checklist below | Public site and onboarding |
| Photos | Which real photos may be used, and that dogs' owners and any people shown have agreed | Home page |

**Plain vaccination checklist (draft, from D11, D73, D74; confirm each line)**

Before your dog can start, we need:
- A vaccination certificate from your vet showing your dog is protected against distemper, hepatitis and parvovirus (the "core" vaccines).
- Leptospirosis vaccination up to date.
- Kennel cough vaccination up to date.
- The date each vaccination was given and when it runs out, from the certificate.
- If it is your dog's first course of vaccinations, we can only take your dog 14 days after the course finishes.

We check these when you book and on the day. If a vaccination runs out, we can't take your dog until a new certificate is accepted.

Checks: D11 and D73 (core and leptospirosis are licence requirements with no override). **[Check]** The kennel cough line is the business's own rule (D11, "mandatory by default"): confirm Stephen wants it stated publicly as a requirement. D73 says titre certificates are not accepted (O16 open): do not mention titres. Do not say "licence requires" unless Stephen confirms the wording, because D11 cites the guidance, not exact legal text.

---

## 4. "What happens next" lines for ended bookings

Plain text shown with a status badge, never colour only. Times in Europe/London. No health or behaviour detail (D33); notes from the Owner stay in the account (D91).

| State | Line | Checks |
|---|---|---|
| Payment time ran out | "You didn't pay in time, so we've released this day and it is no longer booked. You haven't been charged. You can send a new request." | D78 (unpaid holds lapse; "booking not completed" email). **[Check]** "you can send a new request" assumes the day is still open; do not promise it will be available (D101). |
| Request closed (cut-off passed) | "This request wasn't approved before the booking closed at 23:59 the day before, so it has closed at no charge. You can send a new request for another day." | D79 and D8. Same caveat: no promise of availability. |
| Released (place released before payment; for example the Owner removed it) | "We've released this day, and you haven't been charged." | D80 and D81 describe release and waitlist removal with no charge. **[Check]** "Released" is not a defined state name in `decisions.md`. Confirm which events use it. |
| You cancelled, free | "You cancelled at least 48 hours before, so there's no charge. Any card payment is being refunded to the card you used." | D39, D58 (ad hoc days refunded to the card straight away). Stripe keeps its fee (D20) but we say nothing about fees here. Refund timing is the bank's: do not promise a number of days. |
| You cancelled, late | "You cancelled less than 48 hours before, so the day is still charged and can't be refunded." | D8, D20, D39. |
| Member day, cancelled 48+ hours ahead, awaiting Owner approval | "You cancelled at least 48 hours before. We'll review your refund request. If it's approved, the money goes back to your card." | D18, D56, D106 (member refunds need Owner approval, then go to the card automatically per D58). Do not say "refunded" until approved. |
| Member day, cancelled less than 48 hours ahead | "You cancelled less than 48 hours before, so there's no refund for this day." | D18, D56. |
| Cancelled by Luna's K9 Club | "We've had to cancel this day. You won't be charged, and any payment will be refunded to your card." | D39 and D58 (Owner cancels without charge; refunds automatic). **[Check]** Reasons are not given in standard text (D91 keeps notes in the account). Do not add an apology that implies fault or a specific reason. |
| Declined | "We can't take this request. You haven't been charged. You can choose another day." | D80 (polite standard wording, no note in email); D91 (any note visible only in the account). Do not give a reason in the standard line. **[Check]** "You can choose another day" is a suggestion, not a promise; it must not imply that other days have space (D101). |

### Lines to avoid (they break a decision)
- "Only 2 places left", "Nearly full", "Last spot" (D101).
- "Your booking is confirmed" before payment (D76, D80: only approved and paid is secured).
- "Morning" or "afternoon" sessions (D100).
- "Instant booking" or "guaranteed" anything (D76).
- Naming a vaccination, illness or behaviour in an email body (D33, D73).
- Promising a refund date or amount (D58: Stripe fees apply, banks vary).

### Open items for Stephen (shortest list)
1. Choose a variant for sections 1 and 2.
2. Confirm the order of meet-and-greet, trial day and onboarding (D10 does not fix it).
3. Supply the trust facts in section 3 (licence, company, address, contact, insurance, first aid, photos).
4. Confirm the kennel cough requirement can be shown publicly.
5. Say what "Released" should cover in the ended-booking lines.
6. Confirm D96 (one trial day per dog) and D91 (decision notes) are recorded as Approved.
