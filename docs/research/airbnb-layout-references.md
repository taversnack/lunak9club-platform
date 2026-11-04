# Airbnb layout references for the Luna's K9 Club customer site

Author: Researcher agent, 4 Nov 2026. **Advice only, not decisions.** Patterns described in my own words; no Airbnb text, images, logo or exact styling is reproduced. Luna's K9 Club keeps its own navy, rounded cards and navy primary buttons (D97), real photos supplied later by Stephen (placeholders until then).

## 1. What I could and could not see

My fetch tool returns page text and markup, **not rendered visuals**. Marks used below:
- **Observed**: present in text/markup I fetched on 4 Nov 2026.
- **Inferred**: a reasonable reading of observed structure.
- **Not seen / from general knowledge**: I could not see it this session. Treat as unverified and have frontend check on a real phone before copying the idea. Sizes, radii, shadows, ratios and type scales fall here unless stated.

Fetched successfully: search results (https://www.airbnb.co.uk/s/Bedford--United-Kingdom/homes), home (https://www.airbnb.co.uk/), pending help article (https://www.airbnb.co.uk/help/article/2810 and the .com version). **Failed or gated**: listing detail (HTTP 410), trips and inbox (both returned the log-in screen, which needs an account; I did not sign up). So the listing-detail, trips, inbox, booking/request and mobile tab bar sections below are **not observed** and are labelled from general knowledge.

## 2. Observed structure

- **Home** (https://www.airbnb.co.uk/): logo left, category tabs, a segmented three-field search (where, when, who) each with a short label and placeholder, utility links on the right (host link, language, help, log in). Sections are heading, one-line subtitle, a row of about six to seven cards, "See all". Footer in grouped columns with a legal row. Skip link present; some images have empty alt and some card links have no visible text (avoid both).
- **Search results** (https://www.airbnb.co.uk/s/Bedford--United-Kingdom/homes): search fields above results; a results heading with a count; a "Filters" button opening toggles and chips (price, amenities, pets); a "Show map" toggle; numbered pagination. Card anatomy: photo carousel with "Photo 1 of 6" text, badges (award, host type, "New"), a type-and-place title then name, date range, a cancellation tag ("Free cancellation"), rating with review count, total price with a breakdown link. Empty state not captured.
- **Log-in screen** (https://www.airbnb.co.uk/trips/v1 redirected there): one heading, one field (phone or email), one button, an "or" divider for alternatives, a one-line instruction that a code will be sent. Footer repeated.
- **Pending help article** (https://www.airbnb.co.uk/help/article/2810): breadcrumb trail, a how-to title, causes as headed sections, an always-available cancel note, related articles. Wording content: host has 24 hours, status Pending, then Declined or Expired with refund; guest can cancel any time while pending.

## 3. Patterns mapped to Luna's K9 Club pages

Effort S under 0.5 day, M 0.5-2 days, L more. Impact H/M/L. Owner is frontend unless stated.

| # | Pattern | Evidence | Luna's page | Notes, conflicts | Effort / Impact |
|---|---|---|---|---|---|
| 1 | **Header**: logo left, one primary action, account menu right; search card below on home. Utility links minimal. | Observed (home). Sizes not seen. | Public header; customer header | Keep Request primary. No language/currency control needed (GBP, en-GB). | S / M |
| 2 | **Segmented search card** with short field labels and placeholders. Anatomy: Dog, Dates, then a button. | Observed anatomy; look not seen. | Home hero and Book page | Fields: Dog(s) and Day(s) only. **No guests, no session/half-day field (D100).** Do not show a result count ("N available"), which would reveal capacity (D101). | M / H |
| 3 | **Card row with heading, subtitle and "See all"**. | Observed. | Home: "What your day includes", "Our services"; Account: "Your dogs", "Your requests" | Ours are content and account cards, not for-sale listings. No ratings or reviews unless Stephen adds a reviews feature (none in decisions.md). | M / H |
| 4 | **Card anatomy**: image, optional badge, title, meta line, price. | Observed (stack); radius, spacing, shadow not seen. | Dog card, service card, request card | Image ratio: use one consistent landscape ratio per card type (opinion; general knowledge suggests about 4:3 or 3:2). Badge text must be words, not colour only. Price from settings (D3, D44). | M / H |
| 5 | **Photo carousel with a text counter ("Photo 1 of 6")**. | Observed (counter text). | Service and gallery cards | Needs arrows as real buttons and swipe; keep alt text. Use placeholders until Stephen's photos. | M / M |
| 6 | **Cancellation tag on the card** ("Free cancellation"). | Observed. | Request page and booking card | Our line must say "free to cancel at least 48 hours before" (D8, D39, as approved wording), not a bare "Free cancellation". | S / H |
| 7 | **Filters button and chips**. | Observed. | Not needed for customers | Skip. We have one site and a small set of days. Owner day view may borrow chips. | n/a |
| 8 | **Results count heading** ("Over 1,000 homes"). | Observed. | none | **Do not copy: conflicts with D101** (counts reveal capacity). Use "Choose your days". | n/a |
| 9 | **Numbered pagination**. | Observed. | none | Not needed. Use "See all" and a calendar. | n/a |
| 10 | **Single-field sign-in screen** (one heading, one field, one button, "or" divider). | Observed. | Sign-in page (D99 magic link primary) | One email field, "Email me a link", then a "Check your email" page; password as a smaller secondary link. | S / H |
| 11 | **Status page structure**: breadcrumb, headed causes, always-visible cancel note. | Observed (help article). | Help/FAQ and request detail | Our request detail should say Withdraw is always available while pending (D79). | S / M |
| 12 | **Pending state**: status "Pending", guest may cancel any time, then Declined or Expired. | Observed (help text). | Your requests | Our states: Requested, Approved - pay by [time], Confirmed, Declined, Expired, Cancelled. **Conflicts to avoid:** Airbnb takes payment at request and gives the host 24 hours; ours takes **no payment at request**, has **no timer of its own** (closes at 23:59 the day before, D79) and the 24-hour clock starts only **after approval** (D80, D78). Never say "the Owner has 24 hours". | S / H |
| 13 | **Sticky booking card on listing detail** (dates, guests, reserve button, price breakdown); a bottom bar on mobile. | **Not seen (page returned 410); general knowledge.** | Book page: sticky summary bar on mobile ("2 days, 1 dog", Request button); desktop right-hand card | One navy Request button; price breakdown from the price snapshot (D45); the D76 sentence about "does not secure your booking" must sit beside the button. No "Reserve" or "Book now" wording. | M / H |
| 14 | **Request page** with trip summary, price breakdown, a message to the host, and a confirm button. | **Not seen; general knowledge.** | Request confirmation step | Our confirm step shows dog, days, price at request time (D45), cancellation rule, and the D76 notice. Payment fields do **not** appear here (payment follows approval, D80). No free-text message that carries health data (D33). | M / H |
| 15 | **Mobile bottom tab bar** (about four or five icon-and-label items; active item marked). | **Not seen; general knowledge.** | Customer account on phones | Items: Book, Requests, Dogs, Account (opinion). Text labels, current item with `aria-current`, 44 px targets. Owner side is separate and opens on Today. | M / H |
| 16 | **Trips page** with upcoming and past tabs and an empty state with a button. | **Not seen (login-gated); general knowledge.** | Your requests and bookings | Tabs: Upcoming, Past, Needs you. Empty state, for example "No requests yet. Request a day." | S / M |
| 17 | **Inbox** with a thread list and filters. | **Not seen; login-gated.** | Not needed | We use emails and the Today inbox for the Owner; customers do not message. Keep decision notes in the account only (D91). | n/a |
| 18 | **Typographic scale**: large page heading, medium section heading, small card text; generous line spacing. | Heading hierarchy observed; sizes **not seen**. | All pages | Set our own scale in the design tokens (Raleway per D50); keep body at least 16 px. | S / M |
| 19 | **Radius and shadows**: soft rounded cards, light shadow that grows on hover. | **Not seen; general knowledge.** | Cards, buttons (D97 navy rounded) | Use our own token radius and a subtle shadow; no motion required; honour reduced motion. | S / M |
| 20 | **Imagery ratios**: consistent ratios per card type, large hero. | **Not seen.** | Home hero, cards | Placeholders with fixed ratios now, so real photos drop in with no layout shift. Always give width and height. | S / M |
| 21 | **Empty and loading states**: skeleton cards while loading; empty states with one next action. | Not captured; general knowledge. | Every list | Never a blank list. Skeletons need a text alternative. | S / M |
| 22 | **Account menu with avatar**. | Observed in the header as a menu. | Account | Menu: Your requests, Your dogs, Your data, Sign out. | S / L |

## 4. Conflicts and cautions

- **D101**: no counts, no "N available", no "Nearly full", and no "only a few left" nudges, and no results-count heading.
- **D100**: no guests-style session or time-of-day field in the search card or request page.
- **D79**: requests have no timer of their own, and a pending request can be withdrawn at any time with no charge. Airbnb's host-24-hours wording must not be copied.
- **D80**: payment follows approval, with the pay link and hold deadline in London time. Airbnb's pay-then-wait order is the opposite of ours.
- **D76**: the Owner-confirmed notice must stay beside the button. No "Instant Book" idea, no "confirmed" before payment.
- No ratings or reviews exist in the product; do not design cards that expect them.
- **Not copied**: no Airbnb text, images, logo, icon set, colours, font or exact sizes. Study the structure only.

## 5. Suggested build order (opinion)

1. Tokens and card component with placeholder photos at fixed ratios.
2. Customer bottom tab bar and account overview ("Needs you" first, then Next up, Requests, Dogs).
3. Book page with the segmented search card and a sticky summary bar.
4. Request confirmation step and request detail with the status vocabulary.
5. Home: hero, how-it-works, cards row, trust block, footer.

## 6. Next pass

Have frontend capture screenshots of the Airbnb listing, trips and inbox pages while logged in (with their own account, if the team agrees) to settle the unobserved items: radius, shadow, type sizes, image ratios and the mobile tab bar behaviour. I did not and will not sign up.
