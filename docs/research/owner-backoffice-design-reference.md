# Owner back-office design reference

Author: Researcher agent, 13 Nov 2026. **Advice only, not decisions.** For frontend. Patterns described in my own words; no assets or exact styling copied.

**Observed versus inferred.**
- **Observed (live fetch, 13 Nov 2026):** Linear's Inbox docs (https://linear.app/docs/inbox), Stripe's Dashboard basics (https://docs.stripe.com/dashboard/basics), GOV.UK summary list guidance (https://design-system.service.gov.uk/components/summary-list/), NN/g mobile tables (https://www.nngroup.com/articles/mobile-tables/), and Cal.com's home page (https://cal.com/, fetched earlier). The repo's Owner screens (`src/app/admin/...`) were read directly.
- **Not seen:** the logged-in screens of Stripe, Linear, Cal.com and Mindbody (login-gated); two Cal.com docs pages returned 404. Anything about their visual layout, or about Cal.com's confirm-or-reject screen, is **general knowledge, unverified**. Mindbody details are from the earlier scheduling-page fetch (#80 research).
- No sign-ups were made.

Effort S under 0.5 day, M 0.5-2 days, L more. Impact H/M/L. No idea below costs money.

## 1. What the Owner screens do today (observed in the repo)

- **Today** (`src/app/admin/page.tsx`): "Needs you (n)" card with items that show a due badge, an inline action or link, and "All clear / Nothing is waiting for you" when empty; summary cards (Requests waiting, Records to review, Dogs ready to approve, Waiting for meet and greet or trial, Dogs today, Invoices, Incidents, Vaccinations expiring (30 days), Membership days not confirmed, Data requests); "Recent activity".
- **Requests** (`src/app/admin/approvals/page.tsx`): "Waiting for you (n)", each request with Approve and Decline buttons, optional notes (shown in the customer's account only, D91), a section for payment links that couldn't be created.
- **Invoices** (`src/app/admin/invoices/page.tsx`): "Owed to you", "To check", "Approve drafts" with the one-tap "Approve all unchanged drafts (n) - £total" (D95), "Check these first (n)", filters, a wide table (Customer, Month, Number, Days, Total, Still owed, Due, Status) in a scroll region, and an accountant export.
- **Day view** (`src/app/admin/bookings/page.tsx`): Dogs (n) with Check in, No-show, Check out, Undo, internal notes, cancel with reason and "Still charge for this day"; "Requests waiting (n)".

## 2. Inbox of things needing action

**Observed pattern (Linear Inbox docs):** a Priority tab that is the default and holds what needs attention, with the rest under "Other"; actions per item with keyboard shortcuts (mark read or unread, snooze, delete); display options such as show unread first and grouping; a capped item count. **Observed (Stripe Home):** the Home page "surfaces important notifications, like unresolved disputes or identity verifications" alongside charts, and a pinned and recent "Shortcuts" list.

| # | Idea | Why it fits Luna's | Effort / Impact | Owner |
|---|---|---|---|---|
| 1 | **Priority first, everything else second.** Keep "Needs you (n)" as the default top section and fold the other summary cards under one "Everything else" heading that is collapsed on phones. | Stephen's rule: Today is the inbox for approvals plus compliance. Phone users see decisions first. | S / H | frontend |
| 2 | **Group inside the inbox by type with counts**, each group capped (about 5) with "See all (n)". Order: requests (nearest date first), vaccination blocks, unpaid holds about to lapse, month-end drafts, refunds, data requests. | Matches the Linear Priority list idea and the Medtrics-style capped queue from #80. Prevents a long scroll. | S-M / H | frontend (backend for ordering data) |
| 3 | **Every row states its own next action** in words ("Approve or decline: 2 dogs, Tue 3 Dec"), with the decision buttons inline for simple cases and a link to detail for complex ones. | Fewer taps for the Owner; mirrors Stripe's actionable notifications. | M / H | frontend |
| 4 | **Snooze (later)**: hide an item until a chosen day. Not needed for launch; vaccination reminders already re-appear. | Linear's snooze exists; our items are date-driven, so benefit is small. | M / L | owner decision |
| 5 | **Keyboard shortcuts** (J/K to move, A to approve, D to decline) for desktop. | Linear and Stripe offer shortcuts. Nice for speed but not essential on phones. Must keep every action reachable by normal buttons. | M / L | frontend |
| 6 | **Pinned shortcuts**: the Owner can pin Day view, Requests, Invoices to the top of the menu. | Stripe's Shortcuts section. Low value for a single owner with few pages. | S / L | frontend |

**Conflicts / cautions:** the inbox must never show medical or behavioural detail in notification text (D33): dog names and dates only. Urgency in words plus icon, not colour alone.

## 3. Tables as cards on phones

**Observed (NN/g):** options are fewer wider columns, horizontal scrolling with sticky headers and a visible cue that more is off-screen, user-chosen columns, accordions for grouped attributes; adapting is a chance to decide which attributes matter. **Observed (GOV.UK):** use a summary list for key-value facts with row actions, give each action visually hidden text naming the row, keep borders, and use a real `<table>` for genuinely tabular data. **Observed (repo):** invoices use a scrollable table region today.

| # | Idea | Why it fits | Effort / Impact | Owner |
|---|---|---|---|---|
| 7 | **Row becomes a card under about 640 px**: title line (customer and month), one status badge in words, the single most important number (still owed), one "Open" action; other columns appear as a key-value list inside the card. Keep the real table on desktop. | Our invoice, customers and requests lists have 6 to 8 columns; cards avoid horizontal scrolling. | M / H | frontend |
| 8 | **Keep the scroll region as the fallback** with a sticky first column and an arrow or cut-off cue, for the accountant-style wide views (export-like lists). | NN/g says scrolling is acceptable with a clear cue. | S / M | frontend |
| 9 | **Summary list for detail pages** (customer, dog, invoice) with visually hidden action names ("Change phone number for [name]"). | GOV.UK pattern, already near WCAG 2.4.4 habits in the repo. | S-M / M | frontend |
| 10 | **Mark headers properly** (`scope="col"`) and use `role="region"` with a label and `tabIndex=0` for scroll regions (already done on invoices). | Accessibility. | S / M | frontend |

## 4. Approval flows with one-tap actions

**Observed (repo):** Approve and Decline are per-request buttons with an optional note; D80 says decline sends a standard email and the Owner can decline one day first from the day view; D91 notes appear only in the account. **General knowledge, unverified for Cal.com:** bookings that need confirmation show Accept and Reject on the booking row and in the email.

| # | Idea | Why it fits | Effort / Impact | Owner |
|---|---|---|---|---|
| 11 | **One-tap Approve with an undo window.** Approve is a single button; the screen shows "Approved. Pay link sent. Undo" for a short time. Decline asks for an optional note (not required), then shows "Declined. Undo". | Fast on a phone; undo reduces fear of mis-taps. **Caution:** approval creates a hold and sends an email (D78, D80), so Undo must be a real, audited reversal, or the screen must not promise undo. Decisions are final per D77 ("decisions final"), so **this conflicts with D77 unless Stephen agrees**. | M / M | owner decision, then backend |
| 12 | **Show the decision context beside the buttons**: dog name, dates, whether others are booked that day (names only), vaccination status in words, trial status. No health or behaviour detail (D33). | The Owner's job is to check compatibility; this puts the facts one tap away. | M / H | frontend (backend for data) |
| 13 | **Approve selected** for multiple requests: tick rows, one "Approve (n)" bar. Same version-check per item as D95 (month-end). | Matches the month-end pattern; useful for a member's multi-day request. Must refuse any item that changed since it was shown. | M / M | backend, frontend |
| 14 | **Large separated buttons**: Approve and Decline at least 44 px high with space between so they are not mis-tapped; Decline is secondary styling, not red-only (words carry meaning). | Avoids accidental declines on phones. | S / H | frontend |
| 15 | **Email-based approval is not recommended.** Approvals happen only in the signed-in Owner area. | Non-negotiable 1 (every action authorised); one-click links in email are risky. | n/a | n/a |

## 5. Month-end approval screen

**Observed (repo):** "Approve drafts" with one navy action "Approve all unchanged drafts (n) - £total" (D95), a "Check these first (n)" list for drafts that changed or need attention, "Owed to you", and "How membership billing works". **Observed (Mindbody, earlier fetch):** schedules and fees follow business settings; automated waitlists; no-show status after a set time (not a month-end pattern).

| # | Idea | Why it fits | Effort / Impact | Owner |
|---|---|---|---|---|
| 16 | **A three-step header**: 1 Check (drafts needing attention), 2 Approve (the one tap), 3 Sent on the 28th at 09:00. Shows what has happened and what comes next. | Makes the month-end ritual obvious; wording from D24, D55 and D95. | S-M / H | frontend |
| 17 | **Summary tiles before the button**: drafts ready (n), total £, drafts needing attention (n), invoices already approved. Text labels, numbers as text. | The Owner sees the total they are approving; matches D95's "version and total the Owner saw". | S / H | frontend |
| 18 | **After approving, a result panel**: "n approved, £total. n left to check" with links to the leftovers (already partly built as the Drafts approved alert). Keep the skipped list. | Honest reporting, per D95 ("any refused draft stays a draft and is reported"). | S / M | frontend |
| 19 | **Confirm step for the one-tap**: a small confirmation sheet "Approve 14 invoices totalling £X? They are emailed on the 28th" with Cancel and Approve. | Prevents mis-taps on a money action; still two taps total. | S / M | frontend, owner decision |
| 20 | **Per-draft review card** (for the "Check these first" list): customer, month, days, total, what changed since the last version (text), buttons Open and Approve. | Tables as cards, applied to the exception list. | M / M | frontend |

## 6. Other ideas

- **Empty and loading states:** "Nothing needs you" with a short sentence; skeleton cards the shape of rows with hidden loading text.
- **Search:** one search box at the top of Owner screens for dog or customer name (Stripe highlights search as a core Dashboard feature). Not built; effort M, impact M, frontend and backend. Results must be Owner-only.
- **Mobile Owner app feel:** Stripe offers a separate mobile app for key tasks; we do not need one. A phone-friendly Today and Requests is enough.
- **Recent activity:** the existing "Recent activity" audit list is useful; keep it plain text without sensitive data (non-negotiable 5).

## 7. Conflicts and cautions

- **D77:** decisions are final; any undo idea (item 11) needs an explicit Owner decision and an audited reversal.
- **D33 / non-negotiable 5:** no medical, behavioural, payment or contact detail in inbox text, emails or logs.
- **D100 / D101:** the admin day view still labels "Morning" and "Afternoon" sections (seen in `src/app/admin/bookings/page.tsx`, lines near 111 and 118). D100 removes half days everywhere, so frontend should check these labels. The Owner may still see capacity (D101).
- **D95:** keep the per-draft version and total check on any bulk action.
- **No costs:** nothing here needs a paid tool or font.
