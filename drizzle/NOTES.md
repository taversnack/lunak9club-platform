# Migration notes

| Migration | Purpose | Data impact | Rollback / recovery | Destructive |
|---|---|---|---|---|
| 0000_init | Auth tables (users, sessions, accounts, verifications, rate_limits), roles, user_roles, audit_events | New tables only | Drop the new tables on an empty database; never on production with data | No |
| 0001_audit_append_only_and_roles | Append-only triggers on audit_events; seed `owner` and `customer` roles | Inserts two reference rows | `DROP TRIGGER … ; DROP FUNCTION …; DELETE FROM roles WHERE key IN (…)` only if no user_roles reference them | No |
| 0002_customers_dogs_compliance | customers, contacts, vets, dogs (+ health, behaviour, permissions), compliance_requirements, documents, compliance_submissions, assessments, policy_versions, policy_acknowledgements | New tables only | Drop new tables (reverse order) on a database with no Phase 2 data | No |
| 0003_seed_requirements_and_terms | Seed 9 onboarding requirements (D31) and placeholder terms v1 (D34) | Inserts reference rows | Delete the seeded rows if nothing references them | No |
| 0004_bookings | booking_settings, closures, service_days, bookings, booking_dogs (one live booking per dog per day; status/offer/cancel/checkout checks) | New tables only | Drop new tables on a database with no bookings | No |
| 0005_seed_booking_settings_and_bank_holidays | Default settings row; E&W bank holidays to 2028 | Inserts reference rows | Delete seeded rows if unused | No |
| 0006_pricing_memberships | price_books, customer_rates, memberships, price_snapshots; booking_dogs.kind + membership_id | New tables; two new columns with defaults (kind='standard', membership_id null) | Drop new tables/columns on a database with no snapshots | No |
| 0007_pricing_constraints_and_seed | No-overlap constraint on price books, membership FK/check, snapshot lock trigger, seed 2026 price book | Inserts one reference row | Drop constraints/trigger; delete seed row if no snapshots reference it | No |
| 0008_billing | business_settings, document_sequences, invoices, invoice_lines, payments, credit_notes, credit_note_lines, refund_requests, job_runs | New tables only | Drop new tables (reverse order) on a database with no invoices | No |
| 0009_billing_locks_and_seed | Lock triggers: issued invoices and their lines, append-only payments and credit note lines, credit notes (only refund state moves forward); seed number sequences and the business_settings row | Inserts reference rows | Drop triggers/functions; delete seed rows if no invoices exist | No |
| 0010_payments | checkout_attempts, card_refunds, webhook_events; payments.provider_payment_id (unique) + checkout_attempt_id; booking_dogs status `pending_payment`; invoices kind `booking` | New tables and nullable columns; checks and two partial unique indexes widened (drop + recreate) | Drop new tables/columns and restore the previous checks/indexes, only if no `pending_payment` bookings or booking invoices exist | No |
| 0011_payments_locks | FKs for checkout attempts; card_refunds lock trigger | None | Drop trigger/function and FKs | No |
