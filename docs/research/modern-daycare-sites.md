# Modern daycare sites and products: research findings

Author: Researcher agent, 30 Oct 2026. **Advice only, not decisions.** Approved decisions in `docs/decisions.md` win. Nothing was copied from external sites; patterns are described and sources linked. Web search depth was limited (no vendor demos, no logged-in screens), so confidence is stated per item.

## 1. Facts found (with sources)

| # | Fact | Source | Confidence |
|---|---|---|---|
| F1 | Gingr's client portal lets customers submit reservation requests that staff approve; PetExec (now in the Gingr family) offers multi-service requests through its owner portal/app. Daycare software commonly pairs self-serve requests with capacity checks and approval flows. | https://www.guideflow.com/blog/dog-daycare-software , https://petexec.net/service/daycares | Medium |
| F2 | Airbnb "request to book": status is Pending until the host answers; host has 24 h; guest can cancel a pending request any time; Declined/Expired is shown clearly and payment is refunded; pending dates are blocked for others. | https://www.airbnb.com/help/article/2810 | Medium-high |
| F3 | Rover: not booked until both sides accept; a pending request can be withdrawn; the cancellation policy is shown on the listing before booking; refunds return to the original payment method in 1-3 business days. | https://support-uk.rover.com/hc/en-gb/articles/360001113106 | Medium |
| F4 | UK independent daycares typically require a trial/assessment day for new dogs (often charged at the day rate), some charge a credited meet-and-greet (about 25 GBP) or offer it free; require core vaccinations (parvovirus, distemper, leptospirosis, often kennel cough) with the primary course finished about 2 weeks before; worming/flea up to date. | https://miloandconet.squarespace.com/policies-and-procedures , https://the-cuddly-lane-bristol.netlify.app/daycare | Medium (small operators; no national standard) |
| F5 | Needs-attention queues work best as worklists: plain state text, urgent first, each category capped, items clear when handled, counts link to filtered lists. | https://www.process.st/form-dashboard/ , https://docs.medtricslab.com/en/articles/16805050-your-home-dashboard | Low-medium |
| F6 | ICO: email marketing needs consent or a strict soft opt-in (guidance updated 28 Apr 2026 for the Data (Use and Access) Act 2025). Service-message treatment is from general knowledge: verify. | https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/ | High / verify |

## 2. Opinion: how we compare

Our approved flow (request, Owner approval, pay link with 24 h hold, no capacity shown, one trial day, emailed-link sign-in, one-tap month-end) matches or goes beyond the best patterns found. It is closest to Airbnb "request to book" with Rover-style visible cancellation terms. The gaps are wording and status clarity, not structure.

## 2a. Owner rulings received via the coordinator (Stephen)

These now take precedence over the matching recommendations below. Record them in `docs/decisions.md` if not already there.

- Buttons are navy with rounded corners (replaces the sand primary buttons and square corners in D50).
- Emailed magic link is the primary sign-in, with password as a fallback.
- Half days are removed everywhere (amends D12, D23, D35; items touching sessions no longer apply).
- Customers see only "Available" or "Full - waitlist" (no counts, no "Nearly full"). This settles recommendation 12.

## 3. Ranked recommendations

Effort: S under 0.5 day, M 0.5-2 days, L more. Impact H/M/L. None needs paid services.

1. **[frontend] One customer status vocabulary, text plus icon**: Requested, Approved - pay to secure (with the hold deadline as date and time), Confirmed, Declined, Expired, Cancelled, each with a one-line "what happens next". S / H. F2. Check against Owner-confirmed wording (D76, D80).
2. **[frontend] Cancellation rule beside the Request button** ("Free to cancel up to 48 hours before; after that the day is charged") with a link to the full rule. S / H. F3; D8, D20, D39.
3. **[frontend] "Your requests" as a timeline card** (submitted, approved, pay-by, paid) with Withdraw while pending (D79). M / M-H.
4. **[frontend] Owner Today inbox as a worklist**: grouped sections with counts linking to filtered lists; urgent first (vaccination blocks, nearest dates, unpaid holds about to lapse); cap about 5 per group plus "See all"; Approve/Decline inline; "Nothing needs you" empty state; urgency never by colour alone. M / H. F5.
5. **[frontend] Compatibility context inside the approval row** (size/temperament summary, trial status, names of dogs already booked that day). Owner-only (D33). M / H.
6. **[backend] Every status email states the next step and deadline** (hold deadline in Europe/London time; lapse email says how to re-request). No sensitive data (D33). Do not rewrite Owner-confirmed wording (D80, D91). S / M.
7. **[owner decision] Trial/meet-and-greet presentation**: UK operators vary (F4). Ours is a paid trial at the ad hoc rate (D85, sub-defaults still Proposed). Owner to confirm whether the fee is explained as "your first day of care" and whether it is credited. S / M.
8. **[frontend] Membership presentation**: lead with days per week and monthly total, per-day rate secondary; state invoiced on the 28th for next month, due 5 days after sending, change by the 20th. Values from settings, never hard-coded (D5, D19, D24). S / M.
9. **[frontend] Mobile navigation**: customer bottom tab bar (Book, Requests, Dogs, Account); Owner mobile opens on Today; 44 px targets, visible focus, skip link. M / M.
10. **[frontend] Trust signals on public pages**: council licence statement (number supplied by Owner, never invented), vaccination requirements as a plain checklist, a 4-step first-day process (meet-and-greet, trial day, onboarding, book). S / M.
11. **[frontend] Onboarding form**: one topic per step, save and resume, "Step 2 of 5" text progress, upload certificate first. No new questions (D31, D32, D68). M / M.
12. **[owner decision] Waitlist wording versus "customers never see capacity"**: D81 lets customers join a waitlist when a day is full, which reveals fullness for that day. Suggest "This day isn't available to request. Join the waitlist" and avoid counts. S / M.
13. **[frontend] Performance and accessibility**: server-rendered pages, self-hosted font (D50), sized images, no third-party trackers (also avoids a cookie banner). S / M.
14. **[owner decision] UK privacy wording**: booking and invoice emails are service messages; any promotion makes them marketing (F6, verify). Recommend no marketing at launch; later a separate unticked opt-in. Solicitor review of T&Cs/privacy notice (D34) may cost money: flag to PM.
15. **[backend] "Payment received, confirming" state** until the webhook lands, to prevent a second payment. S-M / M. Depends on current implementation.

## 4. Conflicts and cautions

- D81 versus "no spaces left shown": item 12.
- D85 trial sub-defaults are Proposed; item 7 depends on them.
- Email copy must respect Owner-confirmed wording (D76, D80) and D91.
- Competitor details come from vendor summaries and small-operator pages: patterns, not specifications.

## 5. Not covered

Live UK competitor sites, Stripe dashboard patterns, a full WCAG 2.2 walk-through (note 3.3.8 Accessible Authentication: emailed-link sign-in is compliant).
