# ADR 0002 — Billing model: memberships in advance, ad hoc at booking

- Status: Accepted (D5, D6, D16–D21 in `docs/decisions.md`)
- Date: 2026-09-26

## Context
Two customer types: members with regular weekly days, and ad hoc customers. Owner asked whether ad hoc should be invoiced after confirmation with a pay link, or pay at booking with a receipt.

## Decision
**Ad hoc: pay at booking.**
1. Customer picks dates/dogs → sees price → Stripe Checkout.
2. Places held as `pending_payment` (capacity reserved atomically) for 30 min.
3. `checkout.session.completed` webhook → bookings `confirmed`, invoice created as `paid`, receipt emailed.
4. Session expired/failed → hold released, customer told the dates are no longer held.

Why not invoice-then-pay-link: confirmed places could sit unpaid, the Owner would chase debt, a no-show would cost a place and the money, and capacity would be tied up by bookings that may never be paid.

**Membership: invoice in advance on the 28th for the following month (D24).**
- A membership = dog + weekly pattern (e.g. Mon/Wed) + rate band from days per week.
- Nightly job materialises the next 60 days of membership bookings (capacity reserved; clashes reported to Owner).
- On the 25th, `membership-invoicing` job (idempotent per customer+billing month) drafts lines for the following month's scheduled days, minus closures.
- Owner reviews → finalise (number assigned) → PDF + Stripe payment link emailed on the 28th; due 5 days after sending; one reminder at 15:30 on day 4 if unpaid (D25).
- Half days priced at half the applicable day rate (D23).
- Extra days and trial days are paid at booking like ad hoc (at the applicable rate).

**Refunds.** Cancellations ≥48 h ahead create a `refund_request`: ad hoc refunds go to card; membership-day refunds go to card after Owner review. Refunds are Stripe refunds against the original payment, recorded in the ledger; Stripe's fee is not returned.

## Invariants
- Every `booking_dog` is billed by exactly one of: an ad hoc checkout invoice or a membership invoice line (`billing_source` + unique line).
- Credits and adjustments never modify finalised invoices.
- Stripe webhooks deduplicated by event id; Checkout Sessions created with idempotency keys.

## Consequences
Prepayment and postpay both exist, so `billing_mode` is per booking source rather than global. Stripe fees apply to each ad hoc checkout; members pay once a month (fewer fees).
