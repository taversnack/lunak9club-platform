# Airbnb-style patterns for Luna's K9 Club: second research pass

Author: Researcher agent, 30 Oct 2026. **Advice only, not decisions.** Builds on `docs/research/modern-daycare-sites.md`. Respect: customers never see spaces left (D101), full days only (D100), magic-link sign-in primary (D99), navy rounded cards and navy primary buttons (D97). Decision IDs D97-D101 are as relayed by the coordinator; they were not yet in `docs/decisions.md` on main when this was written, so check them.

## 1. Method and honest limits

I fetched live pages this pass. The fetch tool returns page text and markup, **not rendered visuals**, so I could observe structure, copy, ordering, links and accessibility cues, but **not** exact colours, fonts, pixel spacing or animation. Where a bullet says "observed" it came from fetched content; "inferred" or "opinion" is my reading. Some pages failed: rover.com/uk returned 403, linear.app returned only a loading shell. Visual specifics (spacing scale, radii, type sizes) should be set by frontend against our design tokens, not copied.

Pages fetched successfully: airbnb.co.uk home, cal.com, monzo.com, stripe.com/gb, mindbodyonline.com/business/scheduling, lunak9club.co.uk (our current public site), the-cuddly-lane-bristol.netlify.app/daycare, Airbnb help article 2810, GOV.UK Design System date input, W3C WCAG 2.2 target size.

## 2. Observed facts by page

- **Airbnb home** (https://www.airbnb.co.uk/): header has logo, category tabs, a three-segment search (Where / When / Who) with a short label and a placeholder per segment, utility links right. Sections are a heading, a one-line subtitle, a row of about six to seven cards, and a "See all" link. Cards share one stack: image, optional badge, title, meta line, price, rating. A "Skip to content" link exists; many images have empty alt and some card links have no visible text (a gap we should avoid). Footer is grouped columns plus a legal row.
- **Airbnb pending state** (https://www.airbnb.com/help/article/2810): after request and payment the host has 24 hours; status shows Pending, then Declined or Expired with money returned to the original method; the guest can cancel while pending and can message the host.
- **Cal.com** (https://cal.com/): short centred headline with one-line subhead, a filled primary button beside a secondary option, reassurance microcopy right under the buttons ("No credit card required"), a numbered 01/02/03 "how it works", booking previews as sample notification cards ("Booking confirmed", "Booking rescheduled") with relative times, logo strip and a testimonial wall, section rhythm of label, H2, lede, CTA.
- **Stripe** (https://stripe.com/gb): filled primary plus outlined secondary pair repeated at the end; sticky secondary bar on scroll repeating sign-in; large rounded numerals with small captions as a trust strip (one links to a status page); sections separated by whitespace not colour blocks; product shown as simplified UI mock tiles with short labels, not full screenshots; benefit-led imperative headlines in British spelling.
- **Monzo** (https://monzo.com/): one hero image, one headline, one primary button repeated in every section, persistent "Sign up" in the nav; regulation/eligibility qualifiers sit beside the claim ("UK residents. Ts&Cs apply.", FSCS and similar badges near the hero); responsive images in several sizes; skip link.
- **Mindbody** (https://www.mindbodyonline.com/business/scheduling): online capacity can be set below real capacity to reserve places for walk-ins; automated waitlists; recurring bookings; no-show status applied a fixed time after start; clients can self check in. Waitlist there is automatic, ours is manual (D81), so copy the idea of reserved capacity, not the automation.
- **Our current site** (https://lunak9club.co.uk/): "A luxury retreat for country dogs", membership framing, service cards with Learn More, council licence reference, company name, address and contact in the footer, Instagram of real dogs, warm playful tone with pet puns and emoji, countryside photography. The nav has a bug: Dog Walking "Learn More" points at a grooming URL (owner/website content, outside this platform, but worth telling the Owner).
- **Independent UK daycare** (https://the-cuddly-lane-bristol.netlify.app/daycare): one pricing card with a checklist of perks, a free meet and greet repeated as the no-obligation entry, licence number repeated in the footer, trust list (insurance, first-aid training, review count, small groups, cameras), FAQ as expandable headings, first-person warm tone. It does not state vaccination requirements, which is a gap we can beat.
- **GOV.UK date input** (https://design-system.service.gov.uk/components/date-input/): use three separate fields when people know the date; accept month names; never auto-advance between fields; specific error wording ("Enter...", "must be a real date", "must be in the future"); correct `autocomplete` values.
- **WCAG 2.2 target size** (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html): 24 by 24 CSS px minimum with spacing exception. Our 44 px target is stricter and good.

## 3. Ranked ideas

Effort S under 0.5 day, M 0.5-2 days, L more. Impact H/M/L. **No idea here costs money** unless marked [cost]. Owner column says who acts.

| # | Idea | What it is | Seen at | Why it fits Luna's | Effort / Impact | Owner |
|---|---|---|---|---|---|---|
| 1 | Pending-approval status language and "what happens next" line | Status badge (text plus icon) and one sentence per state: Requested, Approved - pay by [date time], Confirmed, Declined, Expired. Guest can cancel while pending; declined or expired states say whether money was taken. | https://www.airbnb.com/help/article/2810 | Our request-then-pay flow is the same shape; removes "did it work?" anxiety. | S / H | frontend (wording check vs D76, D80) |
| 2 | Calendar is a request surface with a sticky summary bar | Tap days, bottom bar shows "2 days, 1 dog" and a navy Request button, safe-area padding. Closed days show a text reason. Only "Available" or "Full - waitlist" per day, no counts (D101). | Airbnb search/date segments, https://www.airbnb.co.uk/ ; Stripe sticky bar https://stripe.com/gb | Mobile-first, one thumb action; keeps capacity hidden. | M / H | frontend |
| 3 | Primary/secondary button pair, one primary per screen | Navy rounded filled button plus outlined secondary, repeated at the end of long pages. | https://stripe.com/gb , https://cal.com/ | Matches D97; gives a clear next step on every page. | S / H | frontend |
| 4 | Reassurance microcopy under the primary button | One short line: "Free to cancel up to 48 hours before" under Request; "No payment until Luna's approves" (check wording vs D8/D76). | https://cal.com/ (under hero buttons) | Answers the two fears, cost and cancellation, at the moment of decision. | S / H | frontend; wording is an owner decision |
| 5 | Card-based "Your dogs" and "Your requests" lists | One consistent card stack: dog photo or initial, name, one status badge with text, one action. Rows of cards with "See all". | https://www.airbnb.co.uk/ cards (image, badge, title, meta, price) | Airbnb feel without copying; consistent, scannable on mobile. | M / H | frontend |
| 6 | "How your first day works" four steps | Numbered 1-4: meet-and-greet, trial day, onboarding, book. Short line each, one button. | https://cal.com/ (01/02/03) | Explains our unusual onboarding; reduces support questions. | S / H | frontend; steps wording is an owner decision |
| 7 | Trust block: licence, insurance, vaccinations, contact | Licence reference, company name, address, plain vaccination requirement list, first-aid and insurance only if the Owner confirms. Repeat licence in footer. Our site already shows the licence; a vaccination checklist is what rivals lack. | https://lunak9club.co.uk/ , https://the-cuddly-lane-bristol.netlify.app/daycare | Trust is the main purchase barrier for dog care; D11/D73 requirements are already defined. | S / H | owner decision (facts) then frontend |
| 8 | Account overview "Needs you" strip first | Top section lists what needs the customer (pay by [time], confirm next month's days, document expiring), then Next up, Requests, Dogs. Empty state: "Nothing needs you." | Stripe/Monzo pattern of one clear action first, https://monzo.com/ ; inbox pattern in first report F5 | Customers have few tasks; surfacing them cuts missed payments and lapsed holds. | M / H | frontend (backend for data) |
| 9 | Qualifiers beside claims | Small terms next to prices and promises: "Per dog per day. Collection within 10 miles included. Cancel free up to 48 hours before." | https://monzo.com/ ("UK residents. Ts&Cs apply.") | UK norm, honest pricing, avoids disputes. Values come from settings, not hard-coded. | S / M | frontend |
| 10 | Date entry: calendar for choosing, GOV.UK-style fields where a date is known | Calendar for choosing days; three plain fields for dates of birth or vaccination dates, accept month names, specific errors, no auto-advance, correct autocomplete. | https://design-system.service.gov.uk/components/date-input/ | Our onboarding and vaccination uploads ask for known dates; fewer errors and WCAG 1.3.5. | M / M | frontend |
| 11 | Reserved online capacity (concept only) | Owner can keep some places back from customer requests while still booking them by hand; customers still only see Available / Full. | https://www.mindbodyonline.com/business/scheduling | Fits "Owner approves each request" and D101. Needs a setting. | M / M | owner decision, then backend |
| 12 | Skip link, real alt text, labelled links on every card | Avoid Airbnb's gaps: empty alt and icon-only links. | https://www.airbnb.co.uk/ (observed gaps) | Our a11y suite gates this; cheap to get right. | S / M | frontend |
| 13 | Sample notification cards on the marketing page | Preview of a booking-approved and pay-link email as UI cards with relative times. | https://cal.com/ | Shows the customer the flow before they sign up. | S / L-M | frontend |
| 14 | Numbers strip | Two or three honest figures only if the Owner wants them (years open, dogs cared for). Do not invent. | https://stripe.com/gb | Social proof in the owner's own words. | S / L | owner decision |
| 15 | Real photography only | Hero and cards use the Owner's own dog photos (outdoor, varied breeds) with responsive sizes and alt text; no stock. | https://lunak9club.co.uk/ , https://monzo.com/ (multi-size images) | Matches the brand's countryside feel; performance via sized images. | M / H | owner decision (photos, consent for dogs and people), then frontend |

## 4. By topic (short notes)

- **Layout, spacing, typography, colour:** I could not see rendered spacing or colour. Opinion: use whitespace not colour blocks to separate sections (Stripe), large headings over small card text, navy for actions and sand as a quiet accent, rounded cards (D97), AA contrast.
- **Hero and entry:** one headline, one subhead, one primary button, with a small secondary text link. A date or dog picker in the hero is a nice later idea; first version should link to the request page.
- **Mobile navigation:** bottom tab bar for signed-in customers (Book, Requests, Dogs, Account); public site keeps a simple menu button with a persistent Request/Sign in button, as Monzo and Stripe keep Sign up/Sign in persistent.
- **Forms and onboarding:** one topic per step, save and resume, "Step 2 of 5" text, GOV.UK date errors (idea 10).
- **Empty and loading states:** every empty list says what it is and the next action ("No requests yet. Request a day"); skeleton cards while loading; never a blank page. Opinion, not observed.
- **Micro-interactions:** subtle 150-200 ms transitions on buttons and cards, confirmation text that changes state on submit, honour prefers-reduced-motion. Opinion.
- **Performance:** server-rendered pages, sized responsive images, self-hosted font (D50), no third-party trackers or carousels. Stripe's looping animation and logo marquees are not needed.

## 5. Conflicts and flags

- Mindbody-style automatic waitlist promotion conflicts with D81 (manual); only the reserved-capacity idea is suggested.
- Any "spots left" or "nearly full" pattern from marketplaces is excluded (D101).
- Half-day or session pickers are excluded (D100).
- Emojis and pet puns suit our social voice; keep emails and legal text plain.
- Costs: none required. Possible costs: professional photography, a licensed icon set or font (not recommended), solicitor review of T&Cs (D34).
- Our public site's Dog Walking link points at a grooming URL; this is outside the platform, tell the Owner.

## 6. Not yet covered

Rover UK (403), Linear (shell only), Gingr/Pawfinity live pages, Mindbody consumer class-booking screens, NN/g studies. A visual review with screenshots would be a good follow-up for the frontend owner.
