-- D30: a document can be accepted but "held" until the virus scan (SCANNER_MODE=clamav) has checked it.
-- Additive: existing rows stay 'not_scanned' (today's behaviour); nothing is rewritten and the files are untouched.
-- Rollback (non-destructive):
--   UPDATE "documents" SET "scan_status" = 'not_scanned' WHERE "scan_status" = 'held';
--   ALTER TABLE "documents" DROP CONSTRAINT "documents_scan_chk";
--   ALTER TABLE "documents" ADD CONSTRAINT "documents_scan_chk" CHECK ("scan_status" in ('not_scanned', 'clean', 'infected'));
--   ALTER TABLE "documents" DROP CONSTRAINT "documents_scan_attempts_chk";
--   ALTER TABLE "documents" DROP COLUMN "scan_attempts", DROP COLUMN "scanned_at";
-- No backfill needed. Brief lock on the (small) documents table while the checks are replaced.
ALTER TABLE "documents" DROP CONSTRAINT "documents_scan_chk";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "scan_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "scanned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_scan_attempts_chk" CHECK ("documents"."scan_attempts" >= 0);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_scan_chk" CHECK ("documents"."scan_status" in ('not_scanned', 'held', 'clean', 'infected'));