CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text DEFAULT 'erasure' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"customer_reason" text,
	"decision_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"retain_until" date,
	"completed_at" timestamp with time zone,
	CONSTRAINT "data_requests_kind_chk" CHECK ("data_requests"."kind" in ('erasure')),
	CONSTRAINT "data_requests_status_chk" CHECK ("data_requests"."status" in ('requested', 'approved', 'declined', 'completed')),
	CONSTRAINT "data_requests_declined_chk" CHECK ("data_requests"."status" <> 'declined' or length(coalesce("data_requests"."decision_reason", '')) > 0)
);
--> statement-breakpoint
CREATE TABLE "incident_photos" (
	"incident_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	CONSTRAINT "incident_photos_incident_id_document_id_pk" PRIMARY KEY("incident_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"body" text NOT NULL,
	"shared_with_customer" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_updates_body_chk" CHECK (length("incident_updates"."body") > 0)
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dog_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"booking_dog_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"description" text NOT NULL,
	"action_taken" text NOT NULL,
	"vet_contacted" boolean DEFAULT false NOT NULL,
	"vet_advice" text,
	"internal_notes" text,
	"status" text DEFAULT 'open' NOT NULL,
	"follow_up_due" date,
	"reported_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_notified_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "incidents_kind_chk" CHECK ("incidents"."kind" in ('injury', 'illness', 'fight', 'behaviour', 'escape', 'other')),
	CONSTRAINT "incidents_severity_chk" CHECK ("incidents"."severity" in ('minor', 'moderate', 'serious')),
	CONSTRAINT "incidents_status_chk" CHECK ("incidents"."status" in ('open', 'closed')),
	CONSTRAINT "incidents_closed_chk" CHECK (("incidents"."status" = 'closed') = ("incidents"."closed_at" is not null)),
	CONSTRAINT "incidents_text_chk" CHECK (length("incidents"."description") > 0 and length("incidents"."action_taken") > 0)
);
--> statement-breakpoint
CREATE TABLE "notification_log" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "welfare_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dog_id" uuid NOT NULL,
	"booking_dog_id" uuid,
	"service_date" date NOT NULL,
	"ate" text NOT NULL,
	"drinking" text NOT NULL,
	"toileting" text NOT NULL,
	"mood" text NOT NULL,
	"concerns" text[] DEFAULT '{}'::text[] NOT NULL,
	"medication_given" text,
	"note" text,
	"shared" boolean DEFAULT false NOT NULL,
	"auto_shared" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "welfare_checks_ate_chk" CHECK ("welfare_checks"."ate" in ('all', 'some', 'none', 'not_fed')),
	CONSTRAINT "welfare_checks_drinking_chk" CHECK ("welfare_checks"."drinking" in ('normal', 'more', 'less')),
	CONSTRAINT "welfare_checks_toileting_chk" CHECK ("welfare_checks"."toileting" in ('normal', 'unusual')),
	CONSTRAINT "welfare_checks_mood_chk" CHECK ("welfare_checks"."mood" in ('happy', 'settled', 'unsettled')),
	CONSTRAINT "welfare_checks_concerns_chk" CHECK ("welfare_checks"."concerns" <@ array['drinking_more', 'drinking_less', 'stress', 'fear', 'aggression', 'anxiety', 'pain']::text[]),
	CONSTRAINT "welfare_checks_autoshare_chk" CHECK (not "welfare_checks"."auto_shared" or "welfare_checks"."shared")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "purpose" text DEFAULT 'compliance' NOT NULL;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_photos" ADD CONSTRAINT "incident_photos_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_photos" ADD CONSTRAINT "incident_photos_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_booking_dog_id_booking_dogs_id_fk" FOREIGN KEY ("booking_dog_id") REFERENCES "public"."booking_dogs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welfare_checks" ADD CONSTRAINT "welfare_checks_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welfare_checks" ADD CONSTRAINT "welfare_checks_booking_dog_id_booking_dogs_id_fk" FOREIGN KEY ("booking_dog_id") REFERENCES "public"."booking_dogs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "welfare_checks" ADD CONSTRAINT "welfare_checks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_requests_status_idx" ON "data_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incident_updates_incident_idx" ON "incident_updates" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incidents_dog_idx" ON "incidents" USING btree ("dog_id","occurred_at");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notification_log_sent_idx" ON "notification_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "welfare_checks_dog_idx" ON "welfare_checks" USING btree ("dog_id","service_date");