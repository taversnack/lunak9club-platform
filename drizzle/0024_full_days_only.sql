-- Half days are removed (Owner ruling, D102+). New booking rows must be full days.
-- Existing half-day rows are honoured as booked: this is NOT VALID, so Postgres does not check
-- rows already in the table, and the created_at escape lets later updates to those old rows
-- (check-in, cancel, refund) keep working. The old session check ('full','am','pm') stays.
-- Rollback: ALTER TABLE "booking_dogs" DROP CONSTRAINT "booking_dogs_full_days_only_chk";
-- No backfill needed; no data is changed.
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_full_days_only_chk" CHECK ("session" = 'full' OR "created_at" < timestamptz '2026-10-30 00:00:00+00') NOT VALID;
