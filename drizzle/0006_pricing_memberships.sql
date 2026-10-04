CREATE TABLE "customer_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"dog_id" uuid,
	"full_day_pence" integer NOT NULL,
	"half_day_pence" integer,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_rates_money_chk" CHECK ("customer_rates"."full_day_pence" >= 0 and ("customer_rates"."half_day_pence" is null or "customer_rates"."half_day_pence" >= 0)),
	CONSTRAINT "customer_rates_range_chk" CHECK ("customer_rates"."ends_on" is null or "customer_rates"."ends_on" >= "customer_rates"."starts_on"),
	CONSTRAINT "customer_rates_reason_chk" CHECK (length("customer_rates"."reason") > 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"dog_id" uuid NOT NULL,
	"weekdays" integer[] NOT NULL,
	"session" text NOT NULL,
	"taxi" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"replaces_id" uuid,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decline_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "memberships_status_chk" CHECK ("memberships"."status" in ('requested', 'active', 'declined', 'ended', 'withdrawn')),
	CONSTRAINT "memberships_session_chk" CHECK ("memberships"."session" in ('full', 'am', 'pm')),
	CONSTRAINT "memberships_weekdays_chk" CHECK (cardinality("memberships"."weekdays") between 1 and 7 and "memberships"."weekdays" <@ array[1,2,3,4,5,6,7]),
	CONSTRAINT "memberships_range_chk" CHECK ("memberships"."ends_on" is null or "memberships"."ends_on" >= "memberships"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "price_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"ad_hoc_full_pence" integer NOT NULL,
	"member_low_full_pence" integer NOT NULL,
	"member_high_full_pence" integer NOT NULL,
	"member_high_from_days" integer DEFAULT 4 NOT NULL,
	"half_day_percent" integer DEFAULT 50 NOT NULL,
	"taxi_pence" integer DEFAULT 0 NOT NULL,
	"multi_dog_discount_percent" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_books_money_chk" CHECK ("price_books"."ad_hoc_full_pence" >= 0 and "price_books"."member_low_full_pence" >= 0 and "price_books"."member_high_full_pence" >= 0 and "price_books"."taxi_pence" >= 0),
	CONSTRAINT "price_books_percent_chk" CHECK ("price_books"."half_day_percent" between 1 and 100 and "price_books"."multi_dog_discount_percent" between 0 and 100),
	CONSTRAINT "price_books_band_chk" CHECK ("price_books"."member_high_from_days" between 2 and 7),
	CONSTRAINT "price_books_range_chk" CHECK ("price_books"."effective_to" is null or "price_books"."effective_to" >= "price_books"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_dog_id" uuid NOT NULL,
	"price_book_id" uuid,
	"customer_rate_id" uuid,
	"rate_code" text NOT NULL,
	"base_pence" integer NOT NULL,
	"discount_pence" integer DEFAULT 0 NOT NULL,
	"taxi_pence" integer DEFAULT 0 NOT NULL,
	"total_pence" integer NOT NULL,
	"explanation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_snapshots_total_chk" CHECK ("price_snapshots"."total_pence" = "price_snapshots"."base_pence" - "price_snapshots"."discount_pence" + "price_snapshots"."taxi_pence" and "price_snapshots"."total_pence" >= 0)
);
--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD COLUMN "kind" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD COLUMN "membership_id" uuid;--> statement-breakpoint
ALTER TABLE "customer_rates" ADD CONSTRAINT "customer_rates_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_rates" ADD CONSTRAINT "customer_rates_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_rates" ADD CONSTRAINT "customer_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_books" ADD CONSTRAINT "price_books_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_booking_dog_id_booking_dogs_id_fk" FOREIGN KEY ("booking_dog_id") REFERENCES "public"."booking_dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_price_book_id_price_books_id_fk" FOREIGN KEY ("price_book_id") REFERENCES "public"."price_books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_customer_rate_id_customer_rates_id_fk" FOREIGN KEY ("customer_rate_id") REFERENCES "public"."customer_rates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_rates_customer_idx" ON "customer_rates" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "memberships_dog_idx" ON "memberships" USING btree ("dog_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "price_snapshots_booking_dog_uq" ON "price_snapshots" USING btree ("booking_dog_id");--> statement-breakpoint
CREATE INDEX "booking_dogs_membership_idx" ON "booking_dogs" USING btree ("membership_id");--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_kind_chk" CHECK ("booking_dogs"."kind" in ('standard', 'membership', 'trial'));