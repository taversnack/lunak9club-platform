# Pre-launch UK compliance and privacy checklist (not legal advice)

Author: Researcher agent, 15 Nov 2026. **This is research, not legal advice, and it reaches no legal conclusions.** It lists facts with sources, what the platform currently does (from `docs/decisions.md` and the repo), and questions for Stephen's solicitor. It does not contradict D30-D34, D64, D65, D71, D109 or D110; where it touches them it only quotes them.

**Dates.** Sources were fetched on 15 Nov 2026. A page that returned nothing useful or an error is marked **not read**; the point is then general knowledge and **unverified**.

## 1. Lawful basis (UK GDPR)

**Facts (source: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/, fetched 15 Nov 2026):**
- The ICO lists seven lawful bases: consent, contract, legal obligation, vital interests, public task, recognised legitimate interest, legitimate interests.
- Most bases require the processing to be "necessary", meaning targeted and proportionate, not merely useful.
- Where special category data is processed, you need a lawful basis **and** a special category condition, both documented.
- Contract only covers contracts with the person or steps they asked for. People can't object under contract but can use erasure and portability. Legitimate interests needs a balancing test, extra detail in privacy information, and allows objection and erasure but not portability.

**What the platform handles (from decisions D31, D32, D62, D63, D68-D70):** customer name, email, phone, address, emergency and collector contacts; dog identity and register fields; vaccination records and uploads; health, diet, medication and behaviour notes; incident reports; daily welfare checks; payments and invoices; audit log.

**Questions for the solicitor:**
1. Which lawful basis (or bases) applies to each purpose: running the booking contract, keeping the licensed dog register, vaccination and welfare records, incident reports, invoicing and tax records, emails, and security logging?
2. Is any of the data about dogs only, or does it become personal data of the owner (for example contact, medical-adjacent notes about their dog, behaviour notes)? Is any of it **special category** data? (The ICO guide says special category data needs an extra condition.)
3. Is the "written consent" for licence matters (feeding, crating, group walks, under-one mixing) satisfied by a signed-in web-form yes/no stored with who and when? This is D71, still awaiting the Owner and the council.

## 2. Privacy notice contents

**Facts (source: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/, fetched 15 Nov 2026).** When collecting data directly, always provide: the organisation's name and contact details; each purpose; the lawful basis; retention periods or the criteria; the individual's rights, with the right to object brought to their attention clearly and separately; and the right to complain to the ICO. Provide if applicable: the legitimate interests pursued; recipients or categories of recipients; transfers to third countries and safeguards; the right to withdraw consent; whether providing data is a statutory or contractual requirement; the existence of automated decision-making. Timing guidance is on a separate ICO page that I did not read.

**Platform facts to feed the notice (from the decisions):** retention periods in D64 (licence records 3 years; vaccination records 3 years after expiry; invoices, payments and audit log 6 years; technical data 90 days; inactive customers anonymised after 3 years); D110 (session IP and user agent cleared 30 days after the session ends); D65 (data download, deletion request, reply within one month); D33 (sensitive data visible to the Owner and the dog's own customer only).

**Status in the repo:** I found a Privacy Notice link on the current public site (lunak9club.co.uk footer, 4 Nov 2026) but I did not find a privacy notice page in `src/app`. **Question:** who writes the platform's notice, and does it replace the existing website one?

**Questions for the solicitor:** Is the notice to cover both the website and the platform? Does the notice need to name processors (see section 3) or categories? What does it say about the Owner's staff-free single-user model?

## 3. Processors and other recipients (to list in the notice and record)

**Fact (source: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/what-needs-to-be-included-in-the-contract/, fetched 15 Nov 2026):** a controller-processor contract must set out the subject matter, duration, nature and purpose, data types and data subject categories, and include eight minimum terms: documented instructions; confidentiality; security; sub-processors only with written authorisation; help with data subject rights; help with security, breach notification and DPIAs; deletion or return at the end; audits and inspections.

| Service | Role in the platform | Status in decisions | Provider terms I could read |
|---|---|---|---|
| App host and managed Postgres | Hosts the app and all data | Container or VPS with managed EU/UK Postgres (D107); provider not chosen | `docs/research/hosting-shortlist.md` (DigitalOcean DPA: SCCs and UK Addendum as a fallback; others unverified) |
| Email provider | Sends transactional email (names, email addresses, links) | Not chosen (D102) | `docs/research/email-provider-shortlist.md` |
| Stripe | Card payments, refunds | Planned (O13, D58, D60) | **Not read** this pass; check Stripe's data processing terms |
| Document storage | Vaccination uploads; local in dev, Cloudflare R2 (EU) in production | D28 | **Not read**; check Cloudflare's DPA and the EU jurisdiction option |
| ClamAV scanner | Scans uploads; runs as a sidecar container | D109 | Self-hosted software, so likely **not** a separate processor, but check with the solicitor |
| Better Auth, libraries | Software used inside the app | ADR 0001 | Not processors (software), but confirm |

**Questions for the solicitor:** Which of these are processors (as opposed to independent controllers)? Which need a signed or accepted DPA? Is reliance on SCCs and the UK Addendum acceptable where a provider is US-based (Stripe, some email providers)? Are international transfers documented?

## 4. Retention and deletion

**Facts:**
- Dog day care licensing statutory guidance (source: https://www.gov.uk/government/publications/animal-activities-licensing-guidance-for-local-authorities/dog-day-care-licensing-statutory-guidance-for-local-authorities, fetched 15 Nov 2026): para 2.1 records must be available for inspection in visible and legible form; para 2.2 records must be kept for at least 3 years from creation, and electronic records backed up; para 25.1 lists the register contents (date of attendance, dog identity, owner and emergency contact, vet and insurance, medical and behavioural history, diet, signed consents, dates of vaccination, worming and flea treatment, current treatment); further record duties are in paras 4.2, 6.2, 7.3, 9.6, 9.8, 9.12, 9.14 and 23.1. No separate retention period for each record type was stated on the page I read.
- The platform's retention is in D64 (3 years for licence records, 6 years for invoices and audit log). D65 says approved deletion closes the account at once and anonymises remaining details when the legal retention period ends.

**Questions for the solicitor:** Is 3 years from creation (or from last visit, as D64/D65 use) the right start point for the licence register? Is 6 years right for invoices and the audit log? Can the audit log hold only IDs and event types? (D33 says no sensitive data in audit metadata.)

## 5. Cookies and PECR

**Facts (source: https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/, fetched 15 Nov 2026, contents page only):** the ICO guidance on storage and access technologies was updated in July 2025 for PECR changes under the Data (Use and Access) Act 2025 and finalised on 29 April 2026. It lists exceptions: communication, strictly necessary, statistical purposes, appearance, emergency assistance, and "a simple means of objecting". The page did not give the content of each exception or say which are new. Two detail pages returned 404 and are **not read**.
- The platform: I searched the repo for analytics and tracking terms and found cookie handling only in authentication and session code (`src/infra/auth/auth.ts`, `src/server/session.ts`, plus redirect helpers). I did not find an analytics or advertising script. **This is a code search, not an audit.**
- D113 and the email shortlist suggest turning off click and open tracking in email.

**Questions for the solicitor:** Are session and security cookies "strictly necessary" for this service? Is a cookie notice still advisable, or a short privacy-notice paragraph enough? If analytics is ever added, which exception or consent applies? Do emails (receipts, reminders, invoices) count as service messages rather than marketing? (The ICO's marketing guidance, fetched earlier in `email-provider-shortlist.md`, concerns marketing; the service-message line is from general knowledge, unverified.)

## 6. ICO registration and fee

**Fact (source: https://ico.org.uk/for-organisations/data-protection-fee/, fetched 15 Nov 2026):** organisations, including sole traders, that use personal information need to pay a data protection fee unless exempt; the fee is set under the Data Protection (Charges and Information) Regulations 2018. The page did not show tiers, amounts, exemptions or penalties; the tiers page returned 404 and is **not read**. Any amounts I might quote from memory are **unverified**, so I give none.

**Cost flag:** the fee is a paid item for the Owner (CLAUDE.md rule 8). The business's existing registration status is **not known to me**.

**Questions:** Is Luna's K9 Club Ltd already registered with the ICO? Which tier applies? Who pays it and renews it?

## 7. Council licence record keeping

See section 4 for the statutory guidance on records. The platform implements the register fields through D68-D70, D72, D73 and D74.

**Open points already in decisions:** D71 (written consent via web form: awaiting the Owner and the council licensing officer), O16 (titre certificates for DHP), and the follow-up about screening records at check-in (`docs/progress.md`).

**Questions:** Does the licensing officer accept an electronic register and an export for inspection (para 2.1 says records must be producible in a visible, legible form)? Should the Owner be able to print or export the register at an inspection, and is that already built? (I did not verify an inspector export; `docs/progress.md` lists it as a later phase.)

## 8. Other items worth asking about

- A data protection impact assessment: is one advisable, given health-adjacent and behavioural notes, uploaded documents and children's contact data (if any)? (General question; no ICO source read this pass.)
- A breach procedure: who is told within 72 hours, and how (general knowledge; no source read).
- The Terms and Conditions: D34 says v1 is a placeholder until solicitor-reviewed text arrives. Ask the solicitor to review the terms, privacy notice and licence consent wording together.
- Email content: CLAUDE.md rule 5 and D33 say no sensitive data in email bodies; processors may still hold names and email addresses in logs (see the email shortlist).
- Under-18 users: customers are adults owning dogs; I found nothing about child data. Ask if any is expected.

## 9. Summary of unverified items

ICO fee tiers and amounts; the detailed cookie exceptions; Stripe and Cloudflare processing terms; the timing rule for privacy information; breach-notification detail; DPIA need; whether a privacy notice page exists in the app.
