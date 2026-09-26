# Migration notes

| Migration | Purpose | Data impact | Rollback / recovery | Destructive |
|---|---|---|---|---|
| 0000_init | Auth tables (users, sessions, accounts, verifications, rate_limits), roles, user_roles, audit_events | New tables only | Drop the new tables on an empty database; never on production with data | No |
| 0001_audit_append_only_and_roles | Append-only triggers on audit_events; seed `owner` and `customer` roles | Inserts two reference rows | `DROP TRIGGER … ; DROP FUNCTION …; DELETE FROM roles WHERE key IN (…)` only if no user_roles reference them | No |
| 0002_customers_dogs_compliance | customers, contacts, vets, dogs (+ health, behaviour, permissions), compliance_requirements, documents, compliance_submissions, assessments, policy_versions, policy_acknowledgements | New tables only | Drop new tables (reverse order) on a database with no Phase 2 data | No |
| 0003_seed_requirements_and_terms | Seed 9 onboarding requirements (D31) and placeholder terms v1 (D34) | Inserts reference rows | Delete the seeded rows if nothing references them | No |
| 0004_bookings | booking_settings, closures, service_days, bookings, booking_dogs (one live booking per dog per day; status/offer/cancel/checkout checks) | New tables only | Drop new tables on a database with no bookings | No |
| 0005_seed_booking_settings_and_bank_holidays | Default settings row; E&W bank holidays to 2028 | Inserts reference rows | Delete seeded rows if unused | No |
