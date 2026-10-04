CREATE TABLE "business_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"trading_name" text DEFAULT 'Luna’s K9 Club' NOT NULL,
	"legal_name" text DEFAULT 'Luna’s K9 Club Ltd' NOT NULL,
	"company_number" text DEFAULT '' NOT NULL,
	"registered_office" text DEFAULT '' NOT NULL,
	"contact_email" text DEFAULT '' NOT NULL,
	"contact_phone" text DEFAULT '' NOT NULL,
	"invoice_prefix" text DEFAULT 'LK9DOUGIE-' NOT NULL,
	"payment_terms_days" integer DEFAULT 5 NOT NULL,
	"reminder_after_days" integer DEFAULT 4 NOT NULL,
	"reminder_time" text DEFAULT '15:30' NOT NULL,
	"draft_day" integer DEFAULT 25 NOT NULL,
	"send_day" integer DEFAULT 28 NOT NULL,
	"send_time" text DEFAULT '09:00' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_settings_singleton_chk" CHECK ("business_settings"."id" = 1),
	CONSTRAINT "business_settings_terms_chk" CHECK ("business_settings"."payment_terms_days" between 0 and 60),
	CONSTRAINT "business_settings_reminder_chk" CHECK ("business_settings"."reminder_after_days" between 1 and 60),
	CONSTRAINT "business_settings_days_chk" CHECK ("business_settings"."draft_day" between 1 and 28 and "business_settings"."send_day" between "business_settings"."draft_day" and 28),
	CONSTRAINT "business_settings_times_chk" CHECK ("business_settings"."reminder_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "business_settings"."send_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "business_settings_prefix_chk" CHECK ("business_settings"."invoice_prefix" ~ '^[A-Z0-9][A-Z0-9-]{0,15}$')
);
--> statement-breakpoint
CREATE TABLE "credit_note_lines" (
	"credit_note_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	CONSTRAINT "credit_note_lines_amount_chk" CHECK ("credit_note_lines"."amount_pence" > 0)
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issue_date" date NOT NULL,
	"amount_pence" integer NOT NULL,
	"reason" text NOT NULL,
	"refund_due_pence" integer DEFAULT 0 NOT NULL,
	"refund_state" text DEFAULT 'none' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_number_unique" UNIQUE("number"),
	CONSTRAINT "credit_notes_amount_chk" CHECK ("credit_notes"."amount_pence" > 0),
	CONSTRAINT "credit_notes_refund_chk" CHECK ("credit_notes"."refund_due_pence" between 0 and "credit_notes"."amount_pence" and ("credit_notes"."refund_state" = 'none') = ("credit_notes"."refund_due_pence" = 0)),
	CONSTRAINT "credit_notes_state_chk" CHECK ("credit_notes"."refund_state" in ('none', 'awaiting_refund', 'refunded')),
	CONSTRAINT "credit_notes_reason_chk" CHECK (length("credit_notes"."reason") > 0)
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"key" text PRIMARY KEY NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "document_sequences_key_chk" CHECK ("document_sequences"."key" in ('invoice', 'credit_note')),
	CONSTRAINT "document_sequences_value_chk" CHECK ("document_sequences"."next_value" >= 1)
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"booking_dog_id" uuid,
	"position" integer NOT NULL,
	"service_date" date,
	"description" text NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"amount_pence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_amount_chk" CHECK ("invoice_lines"."amount_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text DEFAULT 'membership' NOT NULL,
	"period_month" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"number" text,
	"total_pence" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"issue_date" date,
	"due_date" date,
	"reminder_due_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"bill_to_name" text,
	"bill_to_address" text,
	"seller_details" jsonb,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_status_chk" CHECK ("invoices"."status" in ('draft', 'scheduled', 'issued', 'paid', 'void')),
	CONSTRAINT "invoices_kind_chk" CHECK ("invoices"."kind" in ('membership')),
	CONSTRAINT "invoices_period_chk" CHECK ("invoices"."period_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "invoices_total_chk" CHECK ("invoices"."total_pence" >= 0),
	CONSTRAINT "invoices_number_chk" CHECK (("invoices"."status" in ('draft', 'scheduled')) = ("invoices"."number" is null)),
	CONSTRAINT "invoices_issued_fields_chk" CHECK ("invoices"."number" is null or ("invoices"."issued_at" is not null and "invoices"."issue_date" is not null and "invoices"."due_date" is not null and "invoices"."bill_to_name" is not null and "invoices"."seller_details" is not null)),
	CONSTRAINT "invoices_scheduled_chk" CHECK ("invoices"."status" <> 'scheduled' or "invoices"."scheduled_for" is not null)
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"run_key" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_runs_status_chk" CHECK ("job_runs"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	"method" text NOT NULL,
	"received_on" date NOT NULL,
	"reference" text,
	"reason" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_chk" CHECK ("payments"."amount_pence" > 0),
	CONSTRAINT "payments_method_chk" CHECK ("payments"."method" in ('manual', 'stripe')),
	CONSTRAINT "payments_manual_reason_chk" CHECK ("payments"."method" <> 'manual' or length(coalesce("payments"."reason", '')) > 0)
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"invoice_line_id" uuid NOT NULL,
	"booking_dog_id" uuid NOT NULL,
	"amount_pence" integer NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"credit_note_id" uuid,
	"decline_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_requests_status_chk" CHECK ("refund_requests"."status" in ('requested', 'approved', 'declined')),
	CONSTRAINT "refund_requests_amount_chk" CHECK ("refund_requests"."amount_pence" >= 0),
	CONSTRAINT "refund_requests_approved_chk" CHECK (("refund_requests"."status" = 'approved') = ("refund_requests"."credit_note_id" is not null)),
	CONSTRAINT "refund_requests_declined_chk" CHECK ("refund_requests"."status" <> 'declined' or length(coalesce("refund_requests"."decline_reason", '')) > 0)
);
--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_booking_dog_id_booking_dogs_id_fk" FOREIGN KEY ("booking_dog_id") REFERENCES "public"."booking_dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_invoice_line_id_invoice_lines_id_fk" FOREIGN KEY ("invoice_line_id") REFERENCES "public"."invoice_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_booking_dog_id_booking_dogs_id_fk" FOREIGN KEY ("booking_dog_id") REFERENCES "public"."booking_dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_credit_note_id_credit_notes_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."credit_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_note_lines_line_uq" ON "credit_note_lines" USING btree ("invoice_line_id");--> statement-breakpoint
CREATE INDEX "credit_notes_invoice_idx" ON "credit_notes" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_lines_booking_dog_uq" ON "invoice_lines" USING btree ("booking_dog_id");--> statement-breakpoint
CREATE INDEX "invoices_customer_idx" ON "invoices" USING btree ("customer_id","period_month");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_draft_uq" ON "invoices" USING btree ("customer_id","period_month") WHERE "invoices"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_job_key_uq" ON "job_runs" USING btree ("job","run_key");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_requests_booking_dog_uq" ON "refund_requests" USING btree ("booking_dog_id");--> statement-breakpoint
CREATE INDEX "refund_requests_status_idx" ON "refund_requests" USING btree ("status");