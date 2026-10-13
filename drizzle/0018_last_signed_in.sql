ALTER TABLE "users" ADD COLUMN "last_signed_in_at" timestamp with time zone;--> statement-breakpoint
-- MIGRATION NUMBER 0018 IS PROVISIONAL: regenerate just before this PR goes ready if main has moved on.
-- M4 amendment: backfill from what survives today: the latest auth.signed_in audit event (kept 6
-- years) and, for sign-ins the audit trail doesn't show, the latest session activity.
UPDATE "users" u SET "last_signed_in_at" = s.last_at
FROM (
  SELECT user_id, max(at) AS last_at FROM (
    SELECT "actor_user_id" AS user_id, "occurred_at" AS at FROM "audit_events"
      WHERE "action" = 'auth.signed_in' AND "actor_user_id" IS NOT NULL
    UNION ALL
    SELECT "user_id", "updated_at" FROM "sessions"
  ) x GROUP BY user_id
) s
WHERE s.user_id = u."id";
