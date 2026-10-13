-- Review L6: booking_dogs.booking_id is a foreign key filtered on the payment path (pendingDays,
-- releaseHolds) and had no index.
CREATE INDEX "booking_dogs_booking_idx" ON "booking_dogs" USING btree ("booking_id");--> statement-breakpoint
-- Review L5: a double-submit could store two open deletion requests for one customer. Before adding
-- the constraint, keep only the earliest open request per customer (its date starts the one-month
-- UK GDPR clock) and remove later duplicates, exactly as withdrawing a request deletes it.
DELETE FROM "data_requests" d
USING "data_requests" keep
WHERE d."status" = 'requested'
  AND keep."status" = 'requested'
  AND keep."customer_id" = d."customer_id"
  AND (keep."requested_at", keep."id") < (d."requested_at", d."id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_requests_one_open_uq" ON "data_requests" USING btree ("customer_id") WHERE "data_requests"."status" = 'requested';
