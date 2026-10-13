ALTER TABLE "dog_health_profiles" ADD COLUMN "last_wormed_on" date;--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD COLUMN "last_flea_treatment_on" date;--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD COLUMN "exercise_restricted" boolean;--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD COLUMN "exercise_restrictions" text;--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD COLUMN "insured" boolean;--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD COLUMN "insurer" text;--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD COLUMN "insurance_policy_number" text;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "feeding_consent" boolean;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "feeding_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "feeding_consent_by" text;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "feeding_with_others_consent" boolean;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "feeding_with_others_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "feeding_with_others_consent_by" text;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "crating_consent" boolean;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "crating_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "crating_consent_by" text;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "parasite_treatment_consent" boolean;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "parasite_treatment_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "parasite_treatment_consent_by" text;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "medication_consent" boolean;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "medication_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "medication_consent_by" text;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "group_walks_consent" boolean;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "group_walks_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "group_walks_consent_by" text;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "mixing_under_one_consent" boolean;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "mixing_under_one_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD COLUMN "mixing_under_one_consent_by" text;--> statement-breakpoint
ALTER TABLE "dogs" ADD COLUMN "agreed_vet_id" uuid;--> statement-breakpoint
ALTER TABLE "dogs" ADD COLUMN "vet_agreed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "compliance_submissions" ADD COLUMN "administered_on" date;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_feeding_consent_by_users_id_fk" FOREIGN KEY ("feeding_consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_feeding_with_others_consent_by_users_id_fk" FOREIGN KEY ("feeding_with_others_consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_crating_consent_by_users_id_fk" FOREIGN KEY ("crating_consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_parasite_treatment_consent_by_users_id_fk" FOREIGN KEY ("parasite_treatment_consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_medication_consent_by_users_id_fk" FOREIGN KEY ("medication_consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_group_walks_consent_by_users_id_fk" FOREIGN KEY ("group_walks_consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_mixing_under_one_consent_by_users_id_fk" FOREIGN KEY ("mixing_under_one_consent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dogs" ADD CONSTRAINT "dogs_agreed_vet_id_vets_id_fk" FOREIGN KEY ("agreed_vet_id") REFERENCES "public"."vets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD CONSTRAINT "dog_health_exercise_chk" CHECK (("dog_health_profiles"."exercise_restricted" is true and length(coalesce("dog_health_profiles"."exercise_restrictions", '')) > 0) or ("dog_health_profiles"."exercise_restricted" is not true and "dog_health_profiles"."exercise_restrictions" is null));--> statement-breakpoint
ALTER TABLE "dog_health_profiles" ADD CONSTRAINT "dog_health_insurance_chk" CHECK (("dog_health_profiles"."insured" is true and length(coalesce("dog_health_profiles"."insurer", '')) > 0) or ("dog_health_profiles"."insured" is not true and "dog_health_profiles"."insurer" is null and "dog_health_profiles"."insurance_policy_number" is null));--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_feeding_consent_chk" CHECK (("dog_permissions"."feeding_consent" is null) = ("dog_permissions"."feeding_consent_at" is null) and ("dog_permissions"."feeding_consent" is not null or "dog_permissions"."feeding_consent_by" is null));--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_feeding_with_others_consent_chk" CHECK (("dog_permissions"."feeding_with_others_consent" is null) = ("dog_permissions"."feeding_with_others_consent_at" is null) and ("dog_permissions"."feeding_with_others_consent" is not null or "dog_permissions"."feeding_with_others_consent_by" is null));--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_crating_consent_chk" CHECK (("dog_permissions"."crating_consent" is null) = ("dog_permissions"."crating_consent_at" is null) and ("dog_permissions"."crating_consent" is not null or "dog_permissions"."crating_consent_by" is null));--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_parasite_treatment_consent_chk" CHECK (("dog_permissions"."parasite_treatment_consent" is null) = ("dog_permissions"."parasite_treatment_consent_at" is null) and ("dog_permissions"."parasite_treatment_consent" is not null or "dog_permissions"."parasite_treatment_consent_by" is null));--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_medication_consent_chk" CHECK (("dog_permissions"."medication_consent" is null) = ("dog_permissions"."medication_consent_at" is null) and ("dog_permissions"."medication_consent" is not null or "dog_permissions"."medication_consent_by" is null));--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_group_walks_consent_chk" CHECK (("dog_permissions"."group_walks_consent" is null) = ("dog_permissions"."group_walks_consent_at" is null) and ("dog_permissions"."group_walks_consent" is not null or "dog_permissions"."group_walks_consent_by" is null));--> statement-breakpoint
ALTER TABLE "dog_permissions" ADD CONSTRAINT "dog_permissions_mixing_under_one_consent_chk" CHECK (("dog_permissions"."mixing_under_one_consent" is null) = ("dog_permissions"."mixing_under_one_consent_at" is null) and ("dog_permissions"."mixing_under_one_consent" is not null or "dog_permissions"."mixing_under_one_consent_by" is null));--> statement-breakpoint
ALTER TABLE "dogs" ADD CONSTRAINT "dogs_agreed_vet_chk" CHECK ("dogs"."agreed_vet_id" is null or "dogs"."vet_agreed_at" is not null);--> statement-breakpoint
ALTER TABLE "compliance_submissions" ADD CONSTRAINT "compliance_submissions_administered_chk" CHECK ("compliance_submissions"."administered_on" is null or "compliance_submissions"."administered_on" <= "compliance_submissions"."expires_on");