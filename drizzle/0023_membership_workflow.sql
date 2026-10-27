CREATE TABLE "customer_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_month_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"month" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_by" text,
	"by_owner" boolean DEFAULT false NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	CONSTRAINT "membership_month_confirmations_month_chk" CHECK ("membership_month_confirmations"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "membership_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"dog_name" text NOT NULL,
	"dog_id" uuid,
	"weekdays" integer[] NOT NULL,
	"session" text NOT NULL,
	"taxi" boolean DEFAULT false NOT NULL,
	"starts_on" date NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "membership_offers_dog_name_chk" CHECK (length("membership_offers"."dog_name") between 1 and 60),
	CONSTRAINT "membership_offers_session_chk" CHECK ("membership_offers"."session" in ('full', 'am', 'pm')),
	CONSTRAINT "membership_offers_weekdays_chk" CHECK (cardinality("membership_offers"."weekdays") between 1 and 7 and "membership_offers"."weekdays" <@ array[1,2,3,4,5,6,7])
);
--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "confirm_by_day" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_invites" ADD CONSTRAINT "customer_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_invites" ADD CONSTRAINT "customer_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_month_confirmations" ADD CONSTRAINT "membership_month_confirmations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_month_confirmations" ADD CONSTRAINT "membership_month_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_offers" ADD CONSTRAINT "membership_offers_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_offers" ADD CONSTRAINT "membership_offers_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_offers" ADD CONSTRAINT "membership_offers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_invites_token_uq" ON "customer_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_invites_user_idx" ON "customer_invites" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_month_confirmations_uq" ON "membership_month_confirmations" USING btree ("customer_id","month");--> statement-breakpoint
CREATE INDEX "membership_offers_customer_idx" ON "membership_offers" USING btree ("customer_id");--> statement-breakpoint
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_confirm_by_chk" CHECK ("business_settings"."confirm_by_day" between 1 and 28);