# Customer page layout specs (Airbnb-style, Luna's K9 Club)

Author: Researcher agent, 13 Nov 2026. **Advice only, not decisions.** For frontend to use alongside `docs/research/airbnb-layout-references.md` (#126). Patterns only; no Airbnb text, images, logo or exact styling. Our own tokens: navy, rounded cards, navy primary buttons (D97), Raleway (D50).

**Observed versus inferred.** "Current" lines are **observed** in the repo on 13 Nov 2026 (`src/app/account/...`). "Pattern" lines come from my earlier live fetches (Airbnb home, search results, pending help article; cited in #126) or general knowledge; my fetch tool returns text, not visuals, so sizes, radii and shadows are **not seen** and are labelled as suggestions. I did not fetch Airbnb's booking, trips or inbox pages (login-gated or gone).

**Rules every page keeps:** customers never see spaces left, counts or "Nearly full" (D101); full days only (D100); a request is not a booking until approved and paid (D76, D80); requests have no timer of their own and can be withdrawn at any time (D79); status shown in words plus icon, never colour only; cancellation wording "free to cancel at least 48 hours before" (D8, D39).

Effort S under 0.5 day, M 0.5-2 days, L more. Impact H/M/L.

## 1. Book (`src/app/account/book/page.tsx`)

**Current (observed):** one form, stacked cards: "Which dogs?" (checkbox list with a reason when a dog cannot be booked), a "Full day, [hours]" card with a taxi checkbox and an "If a day is full" radio (waitlist or skip), "Choose your dates" (weeks of day cards, each a checkbox with an Available / Full badge, closed reason, "Booked: dog"), then a `RequestBar` button "Check price and availability". Hint: "Bookings close at 23:59 the day before. Weekends and bank holidays are closed."

**Spec (pattern):**
1. **Dog selector as selectable cards**, not a plain checkbox list. Each card: photo or initial block (fixed square ratio, placeholder until real photos), name, one-line status in words ("Ready to book", "Not approved yet: ask for a trial day"). Selected state = thicker navy border **plus** a tick icon **plus** `aria-checked` (not colour alone). Keep native `input type=checkbox` underneath so it works without JavaScript and for screen readers. S-M / H.
2. **Date picking as day cards in a week strip**: on phones a horizontally scrollable or wrapped week row; on desktop a month grid. Each day card: weekday, date, one text badge (Available, Full - waitlist, Closed with reason). Tap toggles; selected shows tick and a navy border. **Never numbers of places** (D101). Disabled days say why in text. Keep `fieldset`/`legend` grouping. M / H.
3. **"If a day is full" appears only after a Full day is selected**, as a single plain line with two radio choices. Reduces clutter; copy stays: waitlist or don't book that day (D81). S / M.
4. **Sticky summary bar** at the bottom on phones (above any tab bar): "2 days, 1 dog" and the navy primary button. Button label today is "Check price and availability"; consider "Review request" because the next page shows price and the D76 notice. The bar never hides form errors (safe-area padding). M / H.
5. **Trial day**: keep as one toggle that explains the one-dog, one-date rule inline; reveal the trial price on the next step only. S / M.
6. **Taxi**: one checkbox row with the included-in-price text (D22). No capacity hint (the 20-dog taxi limit, D26, stays hidden). S / L.

**Conflicts to avoid:** no results counts ("N days available"), no "Nearly full", no morning/afternoon fields (D100), no "Reserve now" wording (D76).

## 2. Request summary and pending-approval state (`book/review/page.tsx`, `/account/requests`, account overview)

**Current (observed):** "Check your booking request" page: a summary card, per-line outcome badges, and an alert "Your booking isn't secured yet". `/account/requests` has "Waiting (n)" and "Earlier requests" lists with "Nothing waiting." and "None yet." empty text. The overview has a "Needs you" card with pay links and the "Your requests and bookings" timeline with a status badge and a "what happens next" line.

**Spec (pattern, from the Airbnb pending-state help article):**
1. **Summary as a receipt card**: dog(s), dates, price per day from the stored price snapshot (D45), total, and the cancellation line. The D76 Owner-confirmed sentence sits directly beside the primary button, not in a footer. S / H.
2. **Status vocabulary** shown everywhere the same: Requested, Approved - pay by [London time], Confirmed, Declined, Expired, Cancelled. Each with a one-line "what happens next". Wording options are in #117; keep the Owner-approved lines. S / H.
3. **A three-step progress line on the request card**: Requested, Approved, Paid. Text labels, current step bold with `aria-current="step"`. Do not show a countdown for the Owner's reply (D79: no timer); show the pay-by deadline only after approval (D78, D80). S-M / H.
4. **Withdraw action always visible while pending**, as a secondary button that goes to a confirm page (exists: `requests/[requestId]/withdraw`). S / M.
5. **Pay card** (after approval): the only navy primary button on the page, with amount, the dog and dates named in the button text (already done for accessibility), and "Pay by [date, time]". S / H.

**Conflicts to avoid:** Airbnb says the host has 24 hours and takes payment at request; ours takes no payment at request and has no Owner timer. Never copy "has 24 hours to respond".

## 3. Membership (`src/app/account/membership/page.tsx`)

**Current (observed):** sections in order: "Confirm your days", "Days we've set up for you", "Your dogs' regular days" (with details/summary for changes and ending membership), "Your recent requests", "Earlier membership requests", "Prices per dog per day". Badges: "Change waiting for approval", confirmed/late.

**Spec (pattern):**
1. **Plan card per dog** at the top: dog name, regular weekdays as seven day chips (text letters plus a tick when on), monthly total estimate, next invoice date, status badge. Replaces the long vertical list. M / H.
2. **"Needs you" first**: "Confirm [month] days by [date]" as the top card with one navy button (D88). Hide the rest below until needed. S / H.
3. **Change and end as secondary actions**, in a "Manage" disclosure on the plan card, each with its notice rule in one sentence (change by the 20th, D19/D48). Keep the existing details/summary but make the summary a visible text button, not a bare disclosure. S / M.
4. **Prices as a small table card** at the bottom (rate per day by days per week, from settings D3/D44), never hard-coded; qualifiers beside it ("per dog per day, taxi included"). S / M.
5. **Pending requests** use the same status vocabulary and the same withdraw pattern as day requests. S / M.

**Conflicts to avoid:** half-day rates (D100). Do not display the Owner's full-day or membership capacity.

## 4. Invoices (`src/app/account/invoices/page.tsx`, `[invoiceId]`)

**Current (observed):** title "Your invoices", one "Invoices" card with a list or "You don't have any invoices yet."

**Spec (pattern):**
1. **Invoice cards**: month and number as the title, amount, a status badge in words (Due [date], Paid, Overdue), and one action ("Pay by card" for due, "Download PDF" for paid). Newest first; a "Due" group above a "Paid" group. S-M / H.
2. **Detail page**: a receipt layout: line items as rows (date, dog, price), credits listed under their own heading, total at the bottom, status and payment date at the top. Finalised invoices are never edited (non-negotiable 4); corrections appear as credits. M / M.
3. **Empty state**: "No invoices yet. Your first one appears after your first booking is paid" is **not** claimed here unless Stephen confirms the timing (D24, D55 differ by customer type). Use "You don't have any invoices yet." S / L.
4. **Refunds in the list**: show approved refunds as a line with "Refund to your card" and date; pending ones as "Waiting for review" (D18, D56, D106). S / M.

## 5. Account overview (`src/app/account/page.tsx`)

**Current (observed):** "Hello, [first name]"; an alert "To finish setting up your account" (profile, emergency contact, terms); cards "Next up", "Needs you" (pay items, confirm days, dog tasks; "All done" badge when empty), "Your requests and bookings" timeline, "Your dogs" with "Add a dog". This already follows the Needs-you-first pattern.

**Spec (pattern):**
1. **Order**: Needs you first (when non-empty), then Next up, then Requests, then Dogs. When Needs you is empty, collapse it to one reassuring line rather than a full card. S / M.
2. **Next up as a hero card**: date large, dog name, dog photo block, taxi note, link to the booking. Empty state: "No days booked yet" plus one navy button. M / H.
3. **Requests as horizontally scrollable cards on phones** (title, "See all"), vertical list on desktop. M / M.
4. **Dog cards** use the dog-card anatomy from the earlier spec sheet: photo or initial, name, status in words ("Ready to book", "Renew vaccination by [date]"), one action. Show the number of things left ("2 things to do") as text. S-M / H.
5. **Bottom tab bar on phones**: Book, Requests, Dogs, Account, with `aria-current="page"` and a visible non-colour current marker. M / H.

## 6. Cross-page notes

- **Skeletons and empty states**: use the same card shape, with hidden loading text and `aria-busy`. Empty text always offers one next step.
- **Errors**: summary at the top and inline, in words (GOV.UK pattern).
- **Placeholders for photos**: fixed ratios so real photos cause no layout shift; mark each placeholder in code.
- **Costs**: none; fonts remain Raleway self-hosted (D50). Professional photography is Stephen's possible cost.
- **Owner decisions still open**: whether to rename the Book button to "Review request"; whether an invoice empty-state timing sentence is wanted.
