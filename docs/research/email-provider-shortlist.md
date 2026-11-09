# Production email provider shortlist (SMTP, transactional only)

Author: Researcher agent. Pages fetched: **9 Nov 2026**. **Advice only, not a decision.** Stephen has not chosen a provider.

Our app sends only transactional email (approvals, pay links, receipts, reminders, month-end invoices) through a provider-neutral SMTP transport (host, port, TLS mode, user, password from env; Mailpit in dev), likely under a few thousand emails a month. CLAUDE.md rule 5: no medical, behavioural, payment, auth or contact data in email bodies. D33: emails say "sign in to see details".

- **Prices are in USD, not GBP.** VAT is **unchecked**.
- Marked **observed** (read from a page on the date above) or **general knowledge / unverified**. Several vendor pages are JavaScript-heavy or blocked, so Brevo's figures and Scaleway's page could not be read.
- No sign-ups, no test sends. Every paid item is a cost to flag to the Owner (non-negotiable 8).
- "Commercial use" column: none of the free tiers below stated a ban on commercial use on the pages I read, but I did not read every Acceptable Use Policy. Confirm before relying on a free tier.

## 1. Summary table

| | SMTP | Free tier (observed) | Cheapest paid (observed) | Where data is held | DPA with SCCs / UK Addendum |
|---|---|---|---|---|---|
| Amazon SES | Yes, London endpoint `email-smtp.eu-west-2.amazonaws.com` | No monthly free quota stated; new accounts get up to $200 credits for 6 months. New accounts start in a sandbox (200 emails per 24 h, 1 per second) until production access is requested | $0.10 per 1,000 emails, no monthly fee (pay as you go) | You choose the region; **London (eu-west-2) is offered** | Yes: SCCs in the service terms and an AWS UK GDPR Addendum (UK IDTA), applied automatically |
| Resend | Yes, all plans | 3,000/month, 100/day cap, 3 domains | Pro $20/mo for 50,000 | Sending region options: N. Virginia, **Ireland**, Sao Paulo, Tokyo. **Account data, logs and metadata are stored in the US regardless of region** | Yes: EU SCCs and UK SCCs (UK Addendum by reference); primary processing in the US |
| Postmark | Yes | 100/month, no overage | Basic $15/mo for 10,000 | **US only** (Chicago-area hosting and AWS); no plans for EU servers | DPA in the terms with SCCs; **no UK Addendum mentioned** |
| Mailgun (Sinch) | Yes, Free and Basic | 100/day, 1 custom domain | Basic $15/mo for 10,000 | **US or EU region choice** from one account | Yes: SCCs and UK Addendum; DPA also lists group transfers worldwide and support staff in other countries |
| Brevo | Yes (page says SMTP relay) | A daily-capped free tier; **figure not readable** | **Unverified** | Page says servers in the EU | Unverified |
| SMTP2GO | Not described on the page | 1,000/month | Starter $10/mo for 10,000 (page header also says "from $15/mo": inconsistent) | Unverified | Unverified |
| Scaleway TEM (EU option) | Unverified | Page returned 403 | Unverified | Scaleway is an EU provider (general knowledge); **unverified** | Unverified |

## 2. Provider notes

### Amazon SES (London)
- **Observed:** SMTP endpoint listed for Europe (London) eu-west-2 (https://docs.aws.amazon.com/general/latest/gr/ses.html). Price $0.10 per 1,000 emails, attachments $0.12 per GB; dedicated IP $24.95/month is optional and not needed (https://aws.amazon.com/ses/pricing/). Default sandbox limits 200 per 24 hours and 1 per second per region until you request production access. SMTP credentials, domain verification and DKIM are per region (https://docs.aws.amazon.com/ses/latest/dg/regions.html). DPA: SCCs in the service terms plus a UK GDPR Addendum (https://aws.amazon.com/compliance/gdpr-center/).
- **DNS effort:** domain verification plus Easy DKIM CNAME records, optional custom MAIL FROM (an MX and an SPF TXT), plus DMARC. Medium (an hour or so). Needs an AWS account, IAM user and SMTP credential generation, and a production-access request.
- **Cost at our volume:** a few thousand emails a month is well under $1. Cheapest by far. Verify nothing hidden in your AWS account (CloudWatch, SNS) if you add them.
- **Logs and content:** general knowledge, **unverified**: SES does not store message bodies by default, and you control event logging, so no email content is held unless you enable archiving. Best fit for "do not store content".
- **Deliverability (general knowledge):** reputation is decent on shared IPs but depends on your own sending behaviour. Wire up bounce and complaint handling (suppression list) early.
- **Effort rating:** highest setup effort of the shortlist, lowest ongoing cost.

### Resend
- **Observed:** 3,000/month free with a 100/day cap, 3 domains; Pro $20/mo for 50,000; SMTP on all plans; log retention 30 days on Free and Pro (https://resend.com/pricing). Ireland sending region exists, but account data, logs and metadata stay in the US (https://resend.com/docs/dashboard/domains/regions). DPA with EU SCCs and UK SCCs by reference (https://resend.com/legal/dpa). The dashboard shows email details, which suggests content is stored (https://resend.com/docs/dashboard/emails/introduction): **I could not confirm any option to disable content storage.**
- The 100/day cap is fine for us but a month-end invoice batch could exceed it; check against the number of members.
- **DNS effort:** low: add SPF/DKIM records Resend displays, plus DMARC. CLAUDE.md names Resend as the intended provider; the app's SMTP transport needs only its SMTP host, port, TLS mode, user and password.
- **Deliverability (general knowledge):** well regarded by developers.

### Postmark
- **Observed:** Free 100/month with no overage allowed; Basic $15/mo for 10,000; message content and metadata kept 45 days (retention add-on can shorten to 7 or 28 days); US-only hosting with no plan for EU servers; DPA with SCCs, no UK Addendum mentioned (https://postmarkapp.com/pricing , https://postmarkapp.com/eu-privacy).
- **Deliverability (general knowledge, unverified here):** reputation is excellent for transactional email, separate streams for transactional and bulk.
- **DNS effort:** low (DKIM and a return-path CNAME, plus DMARC).
- **Concern:** US-only, and the free plan's 100 emails per month is too small for us, so Basic is the minimum.

### Mailgun (Sinch)
- **Observed:** Free 100/day with 1 custom domain and 1 day of log retention; Basic $15/mo for 10,000, no daily limit; SMTP relay; send through the US or the EU from one account (https://www.mailgun.com/pricing/). The DPA incorporates SCCs and the UK Addendum; EU clients' data is hosted in Germany and Belgium for the main platform, but group companies may transfer data worldwide and the DPA does not promise EU-only storage (https://www.mailgun.com/legal/dpa/).
- **Logs:** 1 day on Free and Basic means little stored; message-content storage settings **unverified**.
- **DNS effort:** low-medium (SPF, DKIM, optional tracking CNAME, plus DMARC).

### Brevo (EU option)
- **Observed:** product page says a daily-capped free tier, published transactional pricing, SMTP relay, servers in the EU and GDPR compliance (https://www.brevo.com/products/transactional-email/). **Figures were not readable**; the pricing page returned no numbers and the help article returned 403. DPA and UK Addendum **unverified**. Brevo also bundles marketing tools, which we do not need and could tempt us towards PECR-covered marketing (no decision in `decisions.md` covers marketing email, so none is planned).
- Check whether the free tier adds Brevo branding to messages and whether SMTP is available on Free.

### SMTP2GO
- **Observed:** free plan up to 1,000/month; Starter $10/mo for 10,000 with one page showing both $10 and "from $15/mo" (https://www.smtp2go.com/pricing/). Data location, SMTP details and commercial-use terms are **not stated on the page**.

### Scaleway Transactional Email (UK/EU-hosted candidate)
- Page returned 403; nothing here is verified. Scaleway is an EU provider (general knowledge). Worth checking pricing, SMTP support, retention and the DPA directly, as a way to keep all data in the EU.

## 3. Cross-cutting findings

- **UK data location:** only SES offers a **London** region for the sending service (observed). Mailgun offers an EU region. Resend can send from Ireland but stores account data and logs in the US. Postmark is US-only. For all non-UK options the lawful basis for transfers is SCCs plus (where listed) the UK Addendum, not UK residency.
- **Content logging:** none of the providers read clearly lets us disable content logging. Postmark keeps content 45 days; Resend shows content in its dashboard for 30 days; Mailgun keeps logs for 1 day on the plans we would use. The safest mitigation is the one we already follow: no sensitive data in email bodies (D33 and rule 5), so stored copies hold only a "sign in to see details" notice, a name and dates. Even so, a stored body can include a customer's name and email address (contact data): that is an unavoidable processor copy; note it in the privacy notice and DPA record.
- **Magic-link emails (D99):** they carry a sign-in link that grants access. Short link lifetime already exists (the `MAGIC_LINK_MINUTES` constant in `src/infra/auth/auth.ts`, currently 10 minutes); some providers' link tracking rewrites URLs. **Turn off click and open tracking** for transactional mail on whichever provider is chosen, to avoid tracked or rewritten magic links and extra data collection.
- **DNS records needed (any provider):** SPF (TXT) and DKIM (CNAME or TXT) from the provider, plus a DMARC TXT policy (start at `p=none` with an `rua` report address, then tighten). Use a subdomain such as a mail or notifications subdomain of the club's domain to protect the main domain's reputation. Effort: small, but the Owner must have DNS access; cost: none.
- **Free tiers and commercial use:** none of the pages I read banned commercial use of the free tier, but the pages were incomplete (Resend's terms refer to a separate Acceptable Use Policy I did not read). Confirm before use.

## 4. Opinion (not a recommendation)

- **Amazon SES in London** best matches "UK data location, DPA with UK Addendum, lowest cost, no stored bodies by default (unverified)". Trade-off: most setup effort and an AWS account with a sandbox-exit request.
- **Resend** is the lowest-effort option, and already in our stack. Trade-offs: account data and logs in the US; message content visible in the dashboard for 30 days; a 100-emails-a-day free cap; $20/month when exceeded.
- **Mailgun (EU region)** is a middle path: EU storage option, UK Addendum, short log retention, $15/month if the free 100/day is not enough.
- Postmark is excellent for deliverability but is US-only with no UK Addendum, so it is the weakest fit on data location.
- Because the app sends through plain SMTP, switching later means changing only env variables, so Stephen can start with the lowest-effort option and move.

## 5. Things Stephen or pm should confirm before choosing

1. Whether UK or EU data location is required, or SCCs with the UK Addendum are acceptable.
2. The actual monthly email count and the largest daily batch (month-end invoices, approvals).
3. Who holds DNS access for the sender domain.
4. Provider-specific unverified items above: Brevo prices, Scaleway details, SES content storage, Mailgun content settings, and commercial-use terms for free tiers.
