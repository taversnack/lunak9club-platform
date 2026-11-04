# Customer site: Airbnb-style design plan (for Stephen's approval)

Status: **proposal, nothing built yet.** Author: frontend agent, 4 Nov 2026. Input: `docs/research/airbnb-style-patterns.md`, D97 (navy primary buttons, rounded cards), D99 (email-link sign-in first), D100 (full days only), D101 (no counts, no "nearly full"), D108 (approved wording). Customer side first; the Owner back office adopts the same cards, spacing and radius afterwards.

**Goal:** the feel, style and layout of Airbnb (photo-led, big calm cards, one clear action per screen, a bottom tab bar on phones) in Luna's K9 Club colours and brand: navy, sand, Raleway, the logo, rounded shapes. We copy the *pattern*, not Airbnb's logo, assets, icons or exact styling.

## 1. Design principles

1. One main thing per screen, one navy button.
2. Cards, not tables. Generous space, soft shadows, rounded corners.
3. Photo-led where we have photos; brand-colour placeholder blocks until the Owner supplies real ones.
4. Status is a word plus an icon on every card ("Requested", "Approved - pay by 5 pm Fri"), never colour alone.
5. Say what happens next in one line.
6. Never show how many places are left. A day is Available, or Full with a waitlist option.
7. Phone first (320 px up), then widen. Keyboard, focus rings and 44 px targets everywhere.

## 2. Tokens (extend what is already in `src/app/globals.css`)

| Token | Now | Proposed |
|---|---|---|
| Card radius | 20 px (`--radius-lg`) | keep 20; add `--radius-xl: 24px` for hero and photo cards, `--radius-md: 16px` for inputs and chips |
| Card shadow | one soft shadow | two levels: resting (very soft) and raised on hover/focus (slightly stronger); no shadow in forced-colours mode, use a border |
| Spacing | `--space-1..7` | add a 4/8/16/24/32/48 rhythm; page sections 48 px apart on desktop, 32 px on phone |
| Type | Raleway 16 px base | body 16-18 px, card titles 20 px, page titles 28-34 px; line-height 1.5 |
| Colour | navy `#283039`, sand `#dfc8ad`, cream bg | unchanged. Navy = actions and header; sand = quiet accent and the one exception on a navy header; placeholder photo blocks use navy, sand and warm-cream gradients |
| Buttons | pill, 44 px | keep; "primary" navy filled, "secondary" outlined navy; one primary per screen |

No new fonts, icons packs or paid services. Icons stay as inline SVG we draw ourselves.

## 3. Building blocks (built first, each its own small PR)

1. **Bottom tab bar (phone, signed-in customers).** Four tabs with icon and text label: **Book**, **Bookings**, **Dogs**, **Account**. Current tab has `aria-current="page"` plus a text-weight and pill change (not colour alone). Safe-area padding. Hidden at 768 px and wider; there the same four items sit in the top header. "Account" opens a sheet with Membership, Invoices, Requests, Your details, Contacts, Questions, Terms, Your data, Sign out. This replaces today's wrapped list of 13 links.
2. **Clean top header.** Logo left, on phone a single "Menu" is not needed (tab bar does the work); desktop: logo, four links, "Request a day" button right. Navy, sticky, skip link above it.
3. **Listing card** (`Card` variant): media block (photo or placeholder with the dog's initial), title, one meta line, **one text badge**, **one action**. Used for dogs, requests, bookings, invoices.
4. **Card grid and list**: 1 column on phone, 2 at 640 px, 3 at 1024 px; 24 px gaps.
5. **Search-style card** on the home page and Book: a large rounded card with three tappable segments **Pick days - Dog - Request** (see section 4.1).
6. **Sticky action bar** (already built for Book in #119): reused on Membership and invoice payment pages.
7. **Request status component**: badge + icon + one-line "what happens next" (wording already used in the account overview from D76/D80). Ended-booking lines wait for #103/#104 (see sequence).
8. **Empty, loading and error states**: every empty card says what it is and the next action; skeleton cards (respect `prefers-reduced-motion`); error cards with a retry link.
9. **Placeholder media block**: navy-to-cream gradient with the dog's initial or a simple paw outline, `role="img"` with a text alt only where it carries meaning, otherwise decorative.

## 4. Pages (phone left, desktop right in each sketch)

Sketches are layout only; wording marked **(D108)** is the Owner-approved text.

### 4.1 Home (public) - photo-led

```
PHONE                          DESKTOP
+------------------------+     +----------------------------------------------+
| [logo]       [Sign in] |     | [logo]   Book  How it works  [Sign in] [Req] |
+------------------------+     +----------------------------------------------+
| [   hero photo block   ]|     | [ hero photo block (wide, rounded 24px) ]    |
|  A luxury retreat for  |     |   A luxury retreat for country dogs          |
|  country dogs          |     |  +----------------------------------------+  |
| +--------------------+ |     |  | Pick days | Dog | Request     [ Go ]   |  |
| | Pick days   >      | |     |  +----------------------------------------+  |
| | Dog         >      | |     +----------------------------------------------+
| | [   Request      ] | |     | How your first day works (D108, variant 2)  |
| +--------------------+ |     |  (1)Say hello (2)Trial day (3)Tell us (4)Req |
| How your first day     |     +----------------------------------------------+
| works                  |     | Vaccinations we ask for (checklist)          |
|  1 Say hello           |     | Trust: licence / insurance ... Owner to      |
|  2 A trial day         |     |   confirm (never published as fact)          |
|  3 Tell us about dog   |     | FAQ (cancellation rule)                      |
|  4 Request your days   |     +----------------------------------------------+
| Vaccinations checklist |
| Trust (Owner to conf.) |
| FAQ                    |
+------------------------+
```
- Search-style card for visitors links to Register/Sign in with the intent kept; for signed-in customers it goes to Book with the dog preselected.
- "How your first day works" uses the approved four steps (D108), no trial price in the block.
- Vaccination checklist: core vaccines, leptospirosis, kennel cough; dates from the certificate; 14 days after a first course (D108).
- Trust block (licence, company number, address, insurance, first aid, photos): **not supplied; omitted or shown as "Owner to confirm" only in the Owner's view or code comments. Nothing invented is published.**

### 4.2 Sign-in

Centred rounded card on a cream page. Title "Sign in", one email field, navy "Email me a sign-in link", then a quiet text button "Sign in with a password instead" (D99). After sending: "Check your email" card with the address and a Resend button on a cooldown. Same on phone and desktop; desktop adds a photo block beside the card.

### 4.3 Account overview (`/account`)

```
PHONE                          DESKTOP
+------------------------+     +----------------------------------------+
| Hello, Casey           |     | Hello, Casey                           |
| +--------------------+ |     | +-------------------+ +--------------+ |
| | Next up            | |     | | Next up           | | Needs you    | |
| | Mon 9 Nov - Biscuit| |     | | Mon 9 Nov Biscuit | | Pay by 5pm.. | |
| | [Request a day]    | |     | +-------------------+ +--------------+ |
| +--------------------+ |     | Your requests (cards, timeline)        |
| | Needs you          | |     | Your dogs (listing cards)              |
| +--------------------+ |     +----------------------------------------+
| Your requests (cards)  |
| Your dogs (cards)      |
| [tab bar]              |
+------------------------+
```
Order is already agreed: Next up, Needs you, requests timeline, dogs. Cards get the listing style, dog cards carry the media block and a text badge ("Approved", "Renew by 3 Dec"). Ended-booking lines (declined, payment time ran out, refunded, credited) come from `endedReason` and `paymentState` after #103/#104 merge.

### 4.4 Booking (`/account/book`)

```
PHONE                          DESKTOP
+------------------------+     +--------------------------------------+
| Book day care          |     | Book day care                        |
| Request notice (D76)   |     | Request notice (D76)                 |
| Which dogs?  [cards]   |     | +------------------+ +-------------+ |
| Full day 07:30-18:00   |     | | Dogs, taxi, if   | | Calendar    | |
| Taxi [ ]               |     | | full ...         | | (2 weeks)   | |
| If a day is full ...   |     | +------------------+ | [Available] | |
| Calendar (2 weeks):    |     |                      | [Full-wait] | |
|  Mon 9 [Available]     |     |                      +-------------+ |
|  Tue 10 [Full - join   |     | ------------------------------------ |
|          the waitlist] |     | 2 days, 1 dog  [Request] + reassure  |
| ---------------------- |     +--------------------------------------+
| 2 days, 1 dog [Request]|
| No payment until ...   |
+------------------------+
```
Dogs become tappable cards with a tick (text "Selected"), days become large tappable cards. Only "Available", "Full - join the waitlist" or "Closed" with a reason; no counts, no "nearly full" (D101). Sticky bar and reassurance line already built (#119, D108).

### 4.5 Bookings (`/account/bookings`)

List of listing cards, one per dog-day: date, dog, **status badge** (Requested / Approved - pay by / Confirmed / On the waitlist / Declined / Cancelled), one-line next step, one action (Pay now, Withdraw, Cancel, Leave waitlist). Upcoming first, "Earlier" collapsed. Replaces the dense table; on desktop cards sit in a 2-column grid.

### 4.6 Membership (`/account/membership`)

Per dog one card: the regular weekdays as a row of chips (text, not colour), start date, status badge, one action ("Change days"). "Confirm next month" is a card at the top with the confirm-by date and a navy button. Price table becomes a small three-card "Prices per dog per day" block. Sticky bar for "Send for approval".

### 4.7 Dogs (`/account/dogs`, `/account/dogs/[id]`)

Listing cards (media block with initial, name, breed, one badge such as "Approved" or "2 things to do", one action "Open"). The dog page is a card stack: About, Vaccinations (checklist with dates, text status), Documents, Vet. "Add a dog" is a card at the end of the grid. Date fields use plain three-field dates with month names accepted.

### 4.8 Invoices (`/account/invoices`, detail)

Invoice cards: month, total, badge (Paid / Due by [date] / Overdue), one action (Pay by card, Download). Detail page: summary card, line list, sticky "Pay by card" bar when unpaid. Existing PDF and receipt links stay.

## 5. Sequence (avoids clashes and the #103/#104 dependency)

0. Finish in flight: #119, #121, #124 (CI green), #103/#104 (backend).
1. **Blocks PR A:** tokens (radius, shadow, spacing) + listing card + card grid + placeholder media + empty/loading states. No page changes.
2. **Blocks PR B:** bottom tab bar + clean header + account sheet; remove the 13-link list. (Touches `src/app/account/layout.tsx`, `src/ui/app-shell.tsx`.)
3. **Pages, one PR each**, in this order: Home (+ D108 blocks), Sign-in, Dogs, Bookings, Book (calendar cards), Membership, Invoices.
4. **Account overview** restyle **after** #103/#104 merge, together with the ended-booking lines (it shares `src/app/account/page.tsx` and `src/domain/booking/overview.ts` with backend's work).
5. Owner back office adopts the same tokens and cards afterwards (Today, then tables as cards), per the existing 390 px table PR plan.

Each PR: typecheck, lint, full e2e with axe on mobile and desktop on my own database, screenshots at 320, 390 and 1280 px (and a 200% zoom check) in a PR comment. Tester gates each.

## 6. Accessibility checklist (every PR)

- WCAG 2.2 AA contrast (4.5:1 text, 3:1 for icons/borders that carry meaning); badges are icon + word.
- 44 px targets with spacing; visible 3 px focus ring; focus not hidden under the sticky bar or tab bar (scroll padding).
- Tab bar: `nav` with a label, `aria-current="page"`, text labels always visible.
- Cards: the whole card is not one giant link unless it has one action; headings in order; images decorative unless informative.
- Reduced motion respected; no hover-only information; forced-colours mode keeps borders.
- UK English, plain wording, no counts or "nearly full" (D101), no half-day wording (D100).

## 7. Decisions needed from Stephen

1. **Approve this plan and sequence** (or change the order of pages).
2. **Tab bar items:** Book, Bookings, Dogs, Account. Is that the right four? (Requests would sit in Bookings; Membership and Invoices in the Account sheet.)
3. **Home "search" card:** link-only to start (Pick days, Dog, then Request), or a real inline date picker later?
4. **Photos:** placeholder blocks now; who supplies real dog and site photos, and with what consent for dogs and people?
5. **Trust facts** (licence reference, company number, address, insurance, first aid): please supply, or confirm they stay out of the public site.

## 8. Out of scope

Owner back-office restyle (after the customer side), real photography, any new paid service, changes to booking rules or pricing, Airbnb's logo or assets.
