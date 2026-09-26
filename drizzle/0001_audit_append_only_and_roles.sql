-- Audit trail is append-only. Retention/anonymisation jobs (Phase 7) may modify rows
-- only inside a transaction that sets: SET LOCAL lunak9.audit_maintenance = 'on';
CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('lunak9.audit_maintenance', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'audit_events is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_events_no_truncate() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('lunak9.audit_maintenance', true), 'off') <> 'on' THEN
    RAISE EXCEPTION 'audit_events is append-only (TRUNCATE blocked)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_no_truncate();
--> statement-breakpoint
-- Reference data: launch roles (D13). New roles are added by migration + permission map.
INSERT INTO roles (key, label) VALUES ('owner', 'Owner'), ('customer', 'Customer')
  ON CONFLICT (key) DO NOTHING;
