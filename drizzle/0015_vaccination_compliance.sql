ALTER TABLE "compliance_requirements" ALTER COLUMN "reminder_days" SET DEFAULT '{60,30,14,7}'::integer[];--> statement-breakpoint
ALTER TABLE "compliance_submissions" ADD COLUMN "primary_course_completed_on" date;--> statement-breakpoint
-- D75: add the 60-day reminder to rows still on the old default only, so any reminder days the Owner chose are kept.
UPDATE "compliance_requirements" SET "reminder_days" = '{60,30,14,7}'::integer[] WHERE "reminder_days" = '{30,14,7}'::integer[];
