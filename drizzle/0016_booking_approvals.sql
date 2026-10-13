CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"subject_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"reason" text,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_requests_status_chk" CHECK ("approval_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "booking_dogs" DROP CONSTRAINT "booking_dogs_status_chk";--> statement-breakpoint
ALTER TABLE "booking_dogs" DROP CONSTRAINT "booking_dogs_offer_chk";--> statement-breakpoint
DROP INDEX "booking_dogs_one_per_dog_day_uq";--> statement-breakpoint
-- D84 (hand-added): waitlist offers are retired; any live or lapsed offer goes back on the waitlist.
-- Runs after the old status check is dropped and before the new one (without 'offered') is added.
UPDATE "booking_dogs" SET "status" = 'waitlisted', "offer_expires_at" = NULL WHERE "status" = 'offered';--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_requests_status_created_idx" ON "approval_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_one_pending_uq" ON "approval_requests" USING btree ("type","subject_key") WHERE "approval_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "booking_dogs_one_per_dog_day_uq" ON "booking_dogs" USING btree ("dog_id","service_date") WHERE "booking_dogs"."status" in ('requested', 'confirmed', 'pending_payment', 'waitlisted', 'attended', 'no_show');--> statement-breakpoint
ALTER TABLE "booking_settings" DROP COLUMN "waitlist_offer_hours";--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_status_chk" CHECK ("booking_dogs"."status" in ('requested', 'confirmed', 'pending_payment', 'waitlisted', 'cancelled', 'attended', 'no_show', 'rejected'));--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_offer_chk" CHECK ("booking_dogs"."status" <> 'pending_payment' or "booking_dogs"."offer_expires_at" is not null);