# Decision log

Owner-approved decisions from discovery (26 Sep 2026). Supersedes the defaults in `docs/discovery.md` §6 where they differ.
Status key: **Approved** · **Proposed** (Claude's recommendation, awaiting sign-off) · **Open** (needs an answer).

| ID | Topic | Decision | Status |
|---|---|---|---|
| D1 | Branding | "LunaK9 Club" placeholder branding; legal/invoice details are settings, filled before first live invoice. | Approved |
| D2 | Customer types | Two billing types: **Membership** (regular weekly days, billed monthly in advance) and **Ad hoc** (pay at booking). | Approved |
| D3 | Rates (seed) | Ad hoc £50/dog/day. Membership 1–3 days/week £48/dog/day; 4–5 days/week £45/dog/day. All rates effective-dated config. Matches https://lunak9club.co.uk/dog-day-care-membership-prices/ (checked 26 Sep 2026). | Approved |
| D4 | Multi-dog discount | None at launch; engine supports adding one later. | Approved |
| D5 | Membership invoicing | Invoice generated on the **1st of each month for that month's** scheduled membership days (excluding closures/bank holidays). Owner reviews drafts before sending. **Due 5 days after sent.** *(Timing superseded by D24.)* | Approved |
| D6 | Ad hoc payment | **Pay at booking** via Stripe Checkout; place held for 30 min as `pending_payment`; confirmed on successful payment webhook; paid invoice + receipt generated automatically. Website states all packages are prepaid. | Approved |
| D7 | Opening & capacity | Mon–Fri 07:30–18:00; capacity 20 (placeholder); closed on England & Wales bank holidays. | Approved |
| D8 | Booking rules | Auto-confirm for approved dogs; bookings close 23:59 the day before; free cancellation ≥48 h before; later cancellation or no-show = full day charge. | Approved |
| D9 | Waitlist | Owner promotes manually; customer has 12 h to confirm. | Approved |
| D10 | Onboarding | Meet-and-greet + paid trial day + completed onboarding form; mandatory vaccination certificate, signed T&Cs, vet details, emergency contact. | Approved |
| D11 | Vaccinations | Core + leptospirosis + kennel cough mandatory (confirm against licence); reminders 30/14/7 days; bookings after expiry blocked unless Owner overrides with reason. | Approved |
| D12 | Launch scope | Full day, half day, trial day, taxi/transport, customer-specific rates, memberships, manual adjustments. **Grooming excluded.** | Approved |
| D13 | Roles | Single staff role **Owner** at launch (plus Customer). RBAC kept permission-based so Manager/Staff can be added without schema change. | Approved |
| D14 | Hosting | Free tiers, UK/EU regions; any paid item flagged to the Owner **before** it is needed. See ADR 0001. | Approved |
| D15 | Accounting | CSV export at launch; Xero later. | Approved |
| D16 | Tier basis | Membership rate set by the plan's days per week, not recalculated from weekly bookings. Ad hoc days are always the ad hoc rate. | Approved |
| D17 | Member extra days | Charged at the member's rate, paid at booking (Stripe Checkout). | Approved |
| D18 | Member cancellations | Plan day cancelled ≥48 h ahead → **refund request**, paid to card after Owner review (not account credit). <48 h → no refund. | Approved |
| D19 | Joining / changing | Joining mid-month → part-month invoice at sign-up. Plan changes and leaving take effect from the next 1st; notice by the 20th. | Approved |
| D20 | Ad hoc cancellations | ≥48 h ahead → refund to card (Stripe keeps its fee). <48 h or no-show → no refund. | Approved |
| D21 | Trial day | Charged at the membership rate the dog will enrol on if known; otherwise ad hoc £50. Paid at booking. | Approved |
| D22 | Taxi | Included in all prices; home collection/drop-off for addresses within 10 miles of the centre (per website). No separate taxi charge. | Approved |
| D23 | Half days | Two sessions: **08:00–12:00** and **12:00–16:00**. Capacity tracked per session (a full day uses both). Price = **half the applicable day rate** (ad hoc £25; member £24 or £22.50). | Approved |
| D24 | Membership invoice timing | Invoice for the **following month** sent on the **28th**; due 5 days after sending. Drafts generated on the 25th for Owner review; approved invoices sent 28th 09:00 Europe/London. | Approved (draft/send times proposed) |
| D25 | Payment reminder | If unpaid, one follow-up email at **15:30 Europe/London on the 4th day** after sending. | Approved |
| D26 | Taxi | Limit **20 dogs per day**. Collection/drop-off times fixed the evening before by the Owner (planned by address, distance, traffic); customers notified when the run sheet is published. | Approved |
| D27 | Opening hours | Full day remains 07:30–18:00 (D7); half-day sessions per D23. | Proposed |
| D28 | Document storage | Local development: files on disk in `.data/uploads` (`STORAGE_DRIVER=fs`), served only through the app after a permission check. MinIO was the Owner's first choice but its images are no longer publicly available (Docker Hub removed, quay.io needs a login). Production: Cloudflare R2 (EU) through the same adapter. | Approved (Owner: MinIO, otherwise local) |
| D29 | Upload rules | PDF, JPEG, PNG, WEBP, HEIC; max 10 MB; type checked from file contents, not the name; stored under random keys with no filename; never public. Downloads only via the app after a permission check (links valid 60 s). | Proposed |
| D30 | Virus scanning | No free scanning service in the current stack; uploads are marked "not scanned" and only the Owner and the uploading customer can open them. Revisit before launch. | Proposed — flagged |
| D31 | Onboarding requirements (seed, editable by Owner) | Mandatory: core vaccination, leptospirosis, kennel cough (each with expiry date, from an uploaded certificate), vet details, emergency contact, onboarding form, current T&Cs accepted, meet-and-greet passed, trial day passed. | Proposed (from D10, D11) |
| D32 | Onboarding form contents | Dog: name, breed, sex, date of birth, weight, microchip, neutered, photo optional. Health: allergies, medication, diet, conditions, flea/worming. Behaviour: temperament, triggers, bite/aggression history, handling and emergency instructions. Permissions: transport, photos/social media, emergency vet treatment. Contacts: emergency contacts and authorised collectors. | Proposed |
| D33 | Who sees sensitive dog data | Owner and the dog's own customer only. Never in emails, logs or audit metadata. Emails just say "sign in to see details". | Approved (brief §7) |
| D34 | Terms & conditions | Versioned; v1 is a clearly marked placeholder until solicitor-reviewed text is supplied. Publishing a new version requires customers to accept it again. | Proposed — needs real T&Cs |
| D35 | Phase 3 scope | Customer self-booking of full day / morning / afternoon, with or without taxi, for one or more approved dogs on one or more dates; waitlist; cancellations; Owner calendar, attendance, closures and capacity. **Memberships (recurring days) arrive with pricing in Phase 4; payment at booking (D6) arrives in Phase 6** — until then bookings confirm without payment. | Proposed |
| D36 | Capacity | 20 places each for morning and afternoon (a full day uses one of each); taxi 20 dogs a day; editable per day by the Owner. Checked inside a locked database transaction so the last place can't be sold twice. | Approved (D7, D23, D26) |
| D37 | Booking window | Book up to 90 days ahead, until 23:59 the day before (D8). Closed Saturdays, Sundays and England & Wales bank holidays (seeded to end of 2028 from GOV.UK) plus any Owner closures. | Proposed (90 days) |
| D38 | One booking per dog per day | A dog can have one booking per date (full, morning or afternoon). Changing session = cancel and rebook. | Proposed |
| D39 | Cancellations | Customer cancels in the portal. 48 hours or more before the session starts → free (refund once payments exist, D20). Less than 48 hours → still cancelled but marked "late – charged" (D8). The customer sees which applies before confirming. The Owner can cancel without charge. | Approved (D8, D20) |
| D40 | Vaccinations and dates | A date can't be booked if a mandatory vaccination expires before that date (D11). The customer is told which vaccination and when. | Approved (D11) |
| D41 | Waitlist | If a session is full the customer can join the waitlist. The Owner offers a place by hand (D9); it's held for 12 hours; the customer accepts in the portal or the offer lapses. | Approved (D9) |
| D42 | Owner overrides | The Owner can book any dog (e.g. trial days for dogs not yet approved) and can exceed capacity, but must give a reason; both are audited. | Proposed |
| D43 | Estimated cost | Until the pricing engine (Phase 4), the booking screen shows an estimate at the ad hoc rate (£50 full day, £25 half day, per dog). | Proposed |

## Open questions

Resolved 26 Sep 2026: O1 (→ D3, D16), O2 (→ D17–D19), O3 (→ D21–D23), O4 (→ D20), O5 (→ D5), O7 (→ D23), O8 (→ D23, D27), O9 (→ D26), O10 (→ D24, D25).

| ID | Question | Proposed default |
|---|---|---|
| O6 | Pre-launch hosting cost: Vercel's free Hobby plan is for non-commercial use only. | Develop on Hobby; before go-live choose Vercel Pro (paid) or Cloudflare Workers (free tier allows commercial use). |
| O11 | Invoice still unpaid after the due date: what happens? | Marked overdue on the Owner dashboard; Owner decides case by case. No automatic booking block or late fee. |
