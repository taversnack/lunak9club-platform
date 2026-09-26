CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text,
	"phone" text NOT NULL,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"is_authorised_collector" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_has_purpose_chk" CHECK ("contacts"."is_emergency_contact" or "contacts"."is_authorised_collector")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"phone" text,
	"address_line1" text,
	"address_line2" text,
	"town" text,
	"postcode" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "dog_behaviour_profiles" (
	"dog_id" uuid PRIMARY KEY NOT NULL,
	"temperament" text,
	"triggers" text,
	"bite_history" boolean DEFAULT false NOT NULL,
	"bite_details" text,
	"handling_instructions" text,
	"emergency_instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dog_health_profiles" (
	"dog_id" uuid PRIMARY KEY NOT NULL,
	"allergies" text,
	"medication" text,
	"dietary_requirements" text,
	"medical_conditions" text,
	"flea_and_worming" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dog_permissions" (
	"dog_id" uuid PRIMARY KEY NOT NULL,
	"transport" boolean NOT NULL,
	"photos_and_social_media" boolean NOT NULL,
	"emergency_vet_treatment" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"name" text NOT NULL,
	"breed" text,
	"sex" text,
	"date_of_birth" date,
	"weight_kg" numeric(4, 1),
	"microchip_number" text,
	"neutered" boolean,
	"vet_id" uuid,
	"status" text DEFAULT 'not_started' NOT NULL,
	"status_reason" text,
	"onboarding_submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dogs_status_chk" CHECK ("dogs"."status" in ('not_started', 'pending_review', 'approved', 'suspended', 'rejected')),
	CONSTRAINT "dogs_sex_chk" CHECK ("dogs"."sex" is null or "dogs"."sex" in ('female', 'male')),
	CONSTRAINT "dogs_weight_chk" CHECK ("dogs"."weight_kg" is null or ("dogs"."weight_kg" > 0 and "dogs"."weight_kg" < 150)),
	CONSTRAINT "dogs_microchip_chk" CHECK ("dogs"."microchip_number" is null or "dogs"."microchip_number" ~ '^[0-9]{9,15}$')
);
--> statement-breakpoint
CREATE TABLE "vets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"practice_name" text NOT NULL,
	"vet_name" text,
	"phone" text NOT NULL,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dog_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"outcome" text NOT NULL,
	"assessed_on" date NOT NULL,
	"internal_notes" text,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_kind_chk" CHECK ("assessments"."kind" in ('meet_and_greet', 'trial_day')),
	CONSTRAINT "assessments_outcome_chk" CHECK ("assessments"."outcome" in ('passed', 'not_passed', 'rescheduled'))
);
--> statement-breakpoint
CREATE TABLE "compliance_requirements" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"kind" text NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"blocks_booking" boolean DEFAULT true NOT NULL,
	"reminder_days" integer[] DEFAULT '{30,14,7}'::integer[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_requirements_kind_chk" CHECK ("compliance_requirements"."kind" in ('vaccination', 'vet_details', 'emergency_contact', 'onboarding_form', 'terms', 'assessment'))
);
--> statement-breakpoint
CREATE TABLE "compliance_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dog_id" uuid NOT NULL,
	"requirement_key" text NOT NULL,
	"document_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"expires_on" date NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "compliance_submissions_status_chk" CHECK ("compliance_submissions"."status" in ('pending_review', 'approved', 'rejected', 'replacement_requested', 'superseded')),
	CONSTRAINT "compliance_submissions_reason_chk" CHECK ("compliance_submissions"."status" not in ('rejected', 'replacement_requested') or length(coalesce("compliance_submissions"."review_reason", '')) > 0)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"dog_id" uuid,
	"storage_key" text NOT NULL,
	"display_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"scan_status" text DEFAULT 'not_scanned' NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storageKey_unique" UNIQUE("storage_key"),
	CONSTRAINT "documents_size_chk" CHECK ("documents"."size_bytes" > 0 and "documents"."size_bytes" <= 10485760),
	CONSTRAINT "documents_scan_chk" CHECK ("documents"."scan_status" in ('not_scanned', 'clean', 'infected'))
);
--> statement-breakpoint
CREATE TABLE "policy_acknowledgements" (
	"user_id" text NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_acknowledgements_user_id_policy_version_id_pk" PRIMARY KEY("user_id","policy_version_id")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_key" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text,
	CONSTRAINT "policy_versions_key_chk" CHECK ("policy_versions"."policy_key" in ('terms'))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_behaviour_profiles" ADD CONSTRAINT "dog_behaviour_profiles_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD CONSTRAINT "dog_health_profiles_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dogs" ADD CONSTRAINT "dogs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dogs" ADD CONSTRAINT "dogs_vet_id_vets_id_fk" FOREIGN KEY ("vet_id") REFERENCES "public"."vets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dogs" ADD CONSTRAINT "dogs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vets" ADD CONSTRAINT "vets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_submissions" ADD CONSTRAINT "compliance_submissions_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_submissions" ADD CONSTRAINT "compliance_submissions_requirement_key_compliance_requirements_key_fk" FOREIGN KEY ("requirement_key") REFERENCES "public"."compliance_requirements"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_submissions" ADD CONSTRAINT "compliance_submissions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_submissions" ADD CONSTRAINT "compliance_submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_submissions" ADD CONSTRAINT "compliance_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_customer_idx" ON "contacts" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "dogs_customer_idx" ON "dogs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "dogs_status_idx" ON "dogs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vets_customer_idx" ON "vets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "assessments_dog_idx" ON "assessments" USING btree ("dog_id","kind");--> statement-breakpoint
CREATE INDEX "compliance_submissions_dog_idx" ON "compliance_submissions" USING btree ("dog_id");--> statement-breakpoint
CREATE INDEX "compliance_submissions_status_idx" ON "compliance_submissions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_submissions_one_pending_uq" ON "compliance_submissions" USING btree ("dog_id","requirement_key") WHERE "compliance_submissions"."status" = 'pending_review';--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_submissions_one_approved_uq" ON "compliance_submissions" USING btree ("dog_id","requirement_key") WHERE "compliance_submissions"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "documents_dog_idx" ON "documents" USING btree ("dog_id");--> statement-breakpoint
CREATE INDEX "documents_customer_idx" ON "documents" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_key_version_uq" ON "policy_versions" USING btree ("policy_key","version");