CREATE TABLE "booking_dogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"dog_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"session" text NOT NULL,
	"taxi" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"customer_note" text,
	"internal_note" text,
	"override_reason" text,
	"offer_expires_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"late_cancellation" boolean DEFAULT false NOT NULL,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"attendance_by" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_dogs_session_chk" CHECK ("booking_dogs"."session" in ('full', 'am', 'pm')),
	CONSTRAINT "booking_dogs_status_chk" CHECK ("booking_dogs"."status" in ('confirmed', 'waitlisted', 'offered', 'cancelled', 'attended', 'no_show', 'rejected')),
	CONSTRAINT "booking_dogs_offer_chk" CHECK ("booking_dogs"."status" <> 'offered' or "booking_dogs"."offer_expires_at" is not null),
	CONSTRAINT "booking_dogs_cancel_chk" CHECK ("booking_dogs"."status" <> 'cancelled' or "booking_dogs"."cancelled_at" is not null),
	CONSTRAINT "booking_dogs_checkout_chk" CHECK ("booking_dogs"."checked_out_at" is null or "booking_dogs"."checked_in_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "booking_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"session_capacity" integer DEFAULT 20 NOT NULL,
	"taxi_capacity" integer DEFAULT 20 NOT NULL,
	"open_weekdays" integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
	"full_day_start" text DEFAULT '07:30' NOT NULL,
	"full_day_end" text DEFAULT '18:00' NOT NULL,
	"morning_start" text DEFAULT '08:00' NOT NULL,
	"morning_end" text DEFAULT '12:00' NOT NULL,
	"afternoon_start" text DEFAULT '12:00' NOT NULL,
	"afternoon_end" text DEFAULT '16:00' NOT NULL,
	"max_advance_days" integer DEFAULT 90 NOT NULL,
	"free_cancellation_hours" integer DEFAULT 48 NOT NULL,
	"waitlist_offer_hours" integer DEFAULT 12 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_settings_singleton_chk" CHECK ("booking_settings"."id" = 1),
	CONSTRAINT "booking_settings_capacity_chk" CHECK ("booking_settings"."session_capacity" between 0 and 200 and "booking_settings"."taxi_capacity" between 0 and 200)
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_source_chk" CHECK ("bookings"."source" in ('customer', 'owner'))
);
--> statement-breakpoint
CREATE TABLE "closures" (
	"service_date" date PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_days" (
	"service_date" date PRIMARY KEY NOT NULL,
	"session_capacity" integer,
	"taxi_capacity" integer,
	"note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_days_capacity_chk" CHECK (("service_days"."session_capacity" is null or "service_days"."session_capacity" between 0 and 200) and ("service_days"."taxi_capacity" is null or "service_days"."taxi_capacity" between 0 and 200))
);
--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_dog_id_dogs_id_fk" FOREIGN KEY ("dog_id") REFERENCES "public"."dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_service_date_service_days_service_date_fk" FOREIGN KEY ("service_date") REFERENCES "public"."service_days"("service_date") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_dogs" ADD CONSTRAINT "booking_dogs_attendance_by_users_id_fk" FOREIGN KEY ("attendance_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closures" ADD CONSTRAINT "closures_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_dogs_date_idx" ON "booking_dogs" USING btree ("service_date","status");--> statement-breakpoint
CREATE INDEX "booking_dogs_customer_idx" ON "booking_dogs" USING btree ("customer_id","service_date");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_dogs_one_per_dog_day_uq" ON "booking_dogs" USING btree ("dog_id","service_date") WHERE "booking_dogs"."status" in ('confirmed', 'waitlisted', 'offered', 'attended', 'no_show');--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_id");