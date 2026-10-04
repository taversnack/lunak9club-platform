CREATE TABLE "card_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"credit_note_id" uuid,
	"amount_pence" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"provider_refund_id" text,
	"failure_reason" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_refunds_providerRefundId_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "card_refunds_amount_chk" CHECK ("card_refunds"."amount_pence" > 0),
	CONSTRAINT "card_refunds_status_chk" CHECK ("card_refunds"."status" in ('requested', 'submitted', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "checkout_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"booking_id" uuid,
	"invoice_id" uuid,
	"amount_pence" integer NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text,
	"url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"result_invoice_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "checkout_attempts_providerSessionId_unique" UNIQUE("provider_session_id"),
	CONSTRAINT "checkout_attempts_purpose_chk" CHECK ("checkout_attempts"."purpose" in ('booking', 'invoice')),
	CONSTRAINT "checkout_attempts_status_chk" CHECK ("checkout_attempts"."status" in ('creating', 'open', 'paid', 'expired', 'failed')),
	CONSTRAINT "checkout_attempts_amount_chk" CHECK ("checkout_attempts"."amount_pence" > 0),
	CONSTRAINT "checkout_attempts_target_chk" CHECK (("checkout_attempts"."purpose" = 'booking' and "checkout_attempts"."booking_id" is not null) or ("checkout_attempts"."purpose" = 'invoice' and "checkout_attempts"."invoice_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 1 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "booking_dogs" DROP CONSTRAINT "booking_dogs_status_chk";--> statement-breakpoint
ALTER TABLE "booking_dogs" DROP CONSTRAINT "booking_dogs_offer_chk";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_kind_chk";--> statement-breakpoint
DROP INDEX "booking_dogs_one_per_dog_day_uq";--> statement-breakpoint
DROP INDEX "invoices_one_draft_uq";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_payment_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "checkout_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "card_refunds" ADD CONSTRAINT "card_refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_refunds" ADD CONSTRAINT "card_refunds_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_result_invoice_id_invoices_id_fk" FOREIGN KEY ("result_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_refunds_status_idx" ON "card_refunds" USING btree ("status");--> statement-breakpoint
CREATE INDEX "card_refunds_payment_idx" ON "card_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "checkout_attempts_status_idx" ON "checkout_attempts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "checkout_attempts_booking_idx" ON "checkout_attempts" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "checkout_attempts_invoice_idx" ON "checkout_attempts" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_uq" ON "webhook_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_dogs_one_per_dog_day_uq" ON "booking_dogs" USING btree ("dog_id","service_date") WHERE "booking_dogs"."status" in ('confirmed', 'pending_payment', 'waitlisted', 'offered', 'attended', 'no_show');--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_draft_uq" ON "invoices" USING btree ("customer_id","period_month") WHERE "invoices"."status" = 'draft' and "invoices"."kind" = 'membership';--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_providerPaymentId_unique" UNIQUE("provider_payment_id");--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_status_chk" CHECK ("booking_dogs"."status" in ('confirmed', 'pending_payment', 'waitlisted', 'offered', 'cancelled', 'attended', 'no_show', 'rejected'));--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_offer_chk" CHECK ("booking_dogs"."status" not in ('offered', 'pending_payment') or "booking_dogs"."offer_expires_at" is not null);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_kind_chk" CHECK ("invoices"."kind" in ('membership', 'booking'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_stripe_id_chk" CHECK ("payments"."method" <> 'stripe' or "payments"."provider_payment_id" is not null);