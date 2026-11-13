# Options note for Stephen: the booking cut-off gap (D8, D79)

Status: **decided: option B, chosen by Stephen on 13 Nov 2026.** Built in PR #171 (the approve path refuses once the request's day has passed its cut-off). The text below is kept as the record of the options.

## The situation

D8 and D79 (confirmed 13 Oct 2026): bookings close at 23:59 London the day before. A customer's request that the Owner has not answered by then is cancelled at no charge by the scheduler.

What the code does today:
- **Customers** cannot request a day once its date is today or earlier (`checkBookableDate`: the date must be after today in London, so a day closes to new requests at midnight, not 23:59: a one-minute difference from the wording).
- **The scheduler** (`expireBookingRequests`, every tick) closes requested days whose date is today or earlier. It therefore closes them at the **first tick after midnight**: at a 10-minute tick, up to about 10 minutes late; at 15 minutes, up to about 15.
- **The Owner's approve path** (`onApprove` in `src/server/services/booking-requests.ts`) re-checks vaccinations and capacity but **does not check the cut-off**. So between midnight and the next tick, the Owner can still approve a request for a day that starts that morning.

## What actually happens if the Owner approves in that window

The place is already held by the request, so capacity does not change. Approval then holds the day for payment until the session starts (at least 31 minutes), emails the customer a pay link ("pay to secure"), and the customer can pay and attend as normal. In other words the customer gets a same-day place that D8 says should have closed. Nobody is harmed by it, but it is a gap between the rule as written and the behaviour. It needs the Owner to act in a window of a few minutes after midnight, so it is rare.

The opposite effect of closing the gap: a request still waiting just after midnight would be refused approval and then cancelled by the tick at no charge, so a customer who was about to get a same-day place does not.

## Options

**A. Accept and document (no code).**
- Keep as is; the Owner's own approval in the first minutes after midnight is allowed as a deliberate courtesy.
- Add one sentence to D79 recording it ("the Owner may approve until the scheduler's first run after midnight").
- Effort: documentation only (about 15 minutes).
- Risk: none new. The written rule and the behaviour differ in a small, harmless, Owner-initiated way.

**B. Enforce D79: the approve path refuses once the cut-off has passed, before the tick closes it (small, no new rule).**
- In `onApprove`, for each requested day whose date is today or earlier in London at the time of approval, stop with a plain message ("Bookings for <date> closed at midnight. Decline that day; it will also close on its own"), in the same way a vaccination problem already stops an approval ("Decline that day first"). Use the same date rule the customer path already uses, so the two cannot disagree.
- The Owner can still decline such a day, and can still book the dog themselves through the Owner's "Book a dog" form (which has an audited override for closed days, D42) if they want to give someone a same-day place on purpose.
- Effort: about half a day including tests; no migration.
- Tests: (1) unit test of the date rule at 23:58 on the day before (allowed) and at 00:00 and 00:05 on the day itself (refused); (2) integration test: a request for tomorrow approved at 23:58 today succeeds, approved at 00:01 refuses with the message and changes nothing (no hold, no email, request still pending); (3) a request with several days where only one has passed the cut-off: the message names that day and nothing is approved; (4) the scheduler tick still closes the refused day at no charge; (5) the Owner's override booking still works.
- Risk: low. It makes behaviour match the wording; the cost is the courtesy in option A is lost.

**C. Shrink the window instead (no code, only configuration).**
- Run the scheduler every 5 minutes or less, and/or add a tick at 00:00. The gap does not close, but it shrinks to a few minutes. Can be combined with A.
- Effort: a scheduler setting. Slight extra load.

## Suggested choice

B if D79 should hold exactly as confirmed (it is the smallest change that makes the system do what the rule says). A if the Owner values being able to approve in the first minutes after midnight. Either way C helps. Stephen's call; this is a business rule.

Decision (Stephen, 13 Nov 2026): **B**. Implemented in PR #171 with the tests listed above.
