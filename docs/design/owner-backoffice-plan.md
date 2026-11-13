# Owner back office: restyle plan (proposal)

Status: **proposal for approval.** Author: frontend agent, 13 Nov 2026. Follows `docs/design/airbnb-style-plan.md` (customer side, approved 4 Nov) and D111: the Owner back office keeps its efficient layout and adopts the same cards, spacing and rounded style afterwards. Inputs: researcher's Owner back-office reference (`docs/research/owner-backoffice-design-reference.md`, PR #162) when merged, D77 (one inbox, decisions final), D100 and D101.

## 1. Principles

1. **Efficiency first.** The Owner works on a laptop most of the time: dense tables stay dense on desktop; nothing that is one click today becomes two.
2. **Same look as customers**: 20 px cards, soft shadows, 16 px inputs, navy buttons, Raleway, the same badges (words plus icons, never colour alone).
3. **Phones get cards, not squeezed tables**: below 600 px each row becomes a stacked card (pattern already used by Recent activity, #100, and Bookings, #158).
4. **One-tap approvals stay one tap.** Approve and Decline stay inline in Today; notes stay available on the Requests page. No undo (D77: decisions are final).
5. No personal, medical or payment detail added to any new text or logs. UK English. WCAG 2.2 AA, 44 px targets.

## 2. What changes everywhere (one shared PR first)

- **Owner shell**: replace the wrapped 15-link strip in `src/app/admin/layout.tsx` with the existing `AppShell` sidebar (it already supports a desktop sidebar and a phone drawer). Groups: **Today** (Today, Requests, Reviews), **Day care** (Bookings, Memberships, Customers, Incidents), **Money** (Invoices, Refunds), **Settings** (Opening, Prices, Requirements, Terms, Business, Data requests). Sidebar from 1024 px, Menu drawer below. No tab bar for the Owner (the Owner works at a desk; the drawer is enough on a phone).
- **Table component**: a shared `ResponsiveTable` (CSS only: `data-label` cells, card rows under 600 px) so each page change is small.
- **Page header**: title, one-line help, primary action on the right (already `PageHeader`).

## 3. Pages in order, with sketches

Sketches show 390 px (phone) on the left and 1280 px (desktop) on the right.

### 3.1 Today (`/admin`)
```
PHONE                          DESKTOP
+------------------------+     +----------------------------------------------+
| Today                  |     | [sidebar] Today                              |
| Needs you (7)          |     |  Needs you (7)         | Today's dogs        |
| [Overdue] Request ...  |     |  [Due today] Request   |  12 dogs, 9 in      |
|  Approve  Decline      |     |    Approve Decline     |  Taxi 3, waiting 1  |
| [Due soon] Invoice ... |     |  [Soon] Invoice draft  |---------------------|
|  Open                  |     |    Open                |  Invoices           |
| Vaccinations (2)       |     |  Vaccinations | Records| £120 owed           |
| Dogs today             |     |  Recent activity (table)                     |
| Recent activity (cards)|     +----------------------------------------------+
+------------------------+
```
Already one inbox (#121) with `ownerInbox` order; this PR adds the shell, a two-column layout on desktop, the `document_held` row (#135) and removes the duplicate "Requests waiting" card.

### 3.2 Requests (`/admin/approvals`)
Cards stay (each request is already a card). Add: sticky "Approve" row at the bottom of a long card on phones; notes collapsed under "Add a note". Approve and Decline stay at the top level.

### 3.3 Bookings: day, week, month
```
PHONE (day)                    DESKTOP (day)
| 9 Nov  < >  [date]     |    | 9 Nov < >  [date]    Capacity  Taxi  Waitlist |
| Dogs 12/20             |    | Dogs table: dog | owner | taxi | status | act  |
| Biscuit  [Booked]      |    |  dense rows, check in/out inline              |
|  Check in              |    | Waitlist: give place buttons                  |
```
Day: cards on phones, table on desktop. Week: 7 day cards on phones, the current table on desktop. Month stays a grid. D100: Morning/Afternoon appear only where a half-day booking already exists (the #84 ruling); no new half-day UI.

### 3.4 Customers (`/admin/customers`, customer page)
List: search box on top, cards on phones (name, dogs as chips, badge), table on desktop. Customer page: tabs (Overview, Dogs, Membership, Invoices) become sections with anchor links on phones.

### 3.5 Invoices (`/admin/invoices`, detail)
List: month-end first (the "approve all unchanged drafts" button stays prominent), table on desktop, cards on phones with badge (Draft, To check, Sent, Paid, Overdue) and one action. Detail: summary card, lines, send/record payment actions in a sticky bar on phones.

### 3.6 Remaining (smaller)
Refunds, Reviews, Incidents, Memberships, Settings forms: card tables on phones and the shared inputs; Prices table keeps its columns on desktop.

## 4. Sequence, effort and cost

| PR | Content | Effort | Depends on |
|---|---|---|---|
| O1 | Owner shell (sidebar and drawer) and shared `ResponsiveTable` | 1-1.5 d | customer pages done |
| O2 | Today: two columns, `document_held`, drop duplicate card | 0.5-1 d | O1, #135 |
| O3 | Bookings day and week as cards on phones | 1 d | O1 |
| O4 | Invoices list and detail | 1 d | O1 |
| O5 | Customers list and customer page | 1 d | O1 |
| O6 | Requests polish (sticky actions, collapsed notes) | 0.5 d | O1 |
| O7 | Refunds, reviews, incidents, memberships, settings tables | 1.5 d | O1 |

Costs: none (no new fonts, icons, images or services). Each PR: typecheck, lint, format:check, full e2e and axe on mobile and desktop (own database), renders at 390 and 1280 px, tester gates. E2E selectors that use the Owner's navigation (`name: 'Owner'`, five places) will move to a `navTo`-style helper.

## 5. Must stay efficient (checks for every PR)

- Today approve and decline: still one tap on phone and desktop, same server actions and authorisation.
- Tables on desktop keep their columns, density and sort; no new horizontal scroll at 1280 px.
- Keyboard: every inline action reachable in a sensible order; focus visible; no focus lost after an approval redirect.
- No capacity counts shown to customers anywhere (D101) and no half-day wording added (D100).

## 6. Questions for Stephen

1. Sidebar groups as in section 2: fine, or different grouping?
2. Is a phone tab bar wanted for the Owner too, or is the drawer enough?
3. Any Owner screen you use on a phone daily (so it gets done first)?
