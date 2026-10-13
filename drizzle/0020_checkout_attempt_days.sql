-- dev3/fix-checkout-overlap: records which booking_dogs rows each booking checkout pays for.
-- Existing open checkouts get no rows and keep the old whole-booking behaviour until they finish.
CREATE TABLE "checkout_attempt_days" (
	"checkout_attempt_id" uuid NOT NULL,
	"booking_dog_id" uuid NOT NULL,
	CONSTRAINT "checkout_attempt_days_checkout_attempt_id_booking_dog_id_pk" PRIMARY KEY("checkout_attempt_id","booking_dog_id")
);
--> statement-breakpoint
ALTER TABLE "checkout_attempt_days" ADD CONSTRAINT "checkout_attempt_days_checkout_attempt_id_checkout_attempts_id_fk" FOREIGN KEY ("checkout_attempt_id") REFERENCES "public"."checkout_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_attempt_days" ADD CONSTRAINT "checkout_attempt_days_booking_dog_id_booking_dogs_id_fk" FOREIGN KEY ("booking_dog_id") REFERENCES "public"."booking_dogs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkout_attempt_days_booking_dog_idx" ON "checkout_attempt_days" USING btree ("booking_dog_id");