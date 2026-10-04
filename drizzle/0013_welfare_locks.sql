-- Incident reports are licence records (kept 3 years, D64). The original report can't be edited;
-- corrections and follow-ups are appended. Rows can only be deleted by the retention job, which
-- sets: SET LOCAL lunak9.retention = 'on';
CREATE OR REPLACE FUNCTION incidents_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('lunak9.retention', true), 'off') <> 'on' THEN
      RAISE EXCEPTION 'incident records can only be removed by the retention job' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.dog_id IS DISTINCT FROM OLD.dog_id
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.severity IS DISTINCT FROM OLD.severity
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.action_taken IS DISTINCT FROM OLD.action_taken
    OR NEW.vet_contacted IS DISTINCT FROM OLD.vet_contacted
    OR NEW.vet_advice IS DISTINCT FROM OLD.vet_advice
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'the original incident report is locked – add an update instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER incidents_lock_trg
  BEFORE UPDATE OR DELETE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_lock();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION retention_only_delete() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(current_setting('lunak9.retention', true), 'off') <> 'on' THEN
    RAISE EXCEPTION '% rows can only be removed by the retention job', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER incident_updates_lock_trg
  BEFORE UPDATE OR DELETE ON incident_updates
  FOR EACH ROW EXECUTE FUNCTION retention_only_delete();
--> statement-breakpoint
-- Welfare checks: only the sharing flag may change; deletion only by retention.
CREATE OR REPLACE FUNCTION welfare_checks_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('lunak9.retention', true), 'off') <> 'on' THEN
      RAISE EXCEPTION 'welfare checks can only be removed by the retention job' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF (to_jsonb(NEW) - 'shared') IS DISTINCT FROM (to_jsonb(OLD) - 'shared') OR (OLD.auto_shared AND NOT NEW.shared) THEN
    RAISE EXCEPTION 'welfare checks are locked once recorded' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER welfare_checks_lock_trg
  BEFORE UPDATE OR DELETE ON welfare_checks
  FOR EACH ROW EXECUTE FUNCTION welfare_checks_lock();
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_purpose_chk CHECK (purpose in ('compliance', 'incident'));
