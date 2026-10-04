-- Issued invoices are locked (CLAUDE.md non-negotiable 4). Only status, payment/reminder/email
-- timestamps and version may change once a number is assigned; issued invoices are never deleted.
CREATE OR REPLACE FUNCTION invoices_lock_issued() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.number IS NOT NULL OR OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'only draft invoices can be deleted' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.number IS NOT NULL THEN
    IF NEW.number IS DISTINCT FROM OLD.number
      OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.period_month IS DISTINCT FROM OLD.period_month
      OR NEW.total_pence IS DISTINCT FROM OLD.total_pence
      OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
      OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.reminder_due_at IS DISTINCT FROM OLD.reminder_due_at
      OR NEW.bill_to_name IS DISTINCT FROM OLD.bill_to_name
      OR NEW.bill_to_address IS DISTINCT FROM OLD.bill_to_address
      OR NEW.seller_details IS DISTINCT FROM OLD.seller_details
      OR NEW.status NOT IN ('issued', 'paid', 'void') THEN
      RAISE EXCEPTION 'issued invoice % is locked', OLD.number USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_lock_issued_trg
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_lock_issued();
--> statement-breakpoint
-- Lines can only change while their invoice is a draft (a missing parent means a draft is being deleted).
CREATE OR REPLACE FUNCTION invoice_lines_lock() RETURNS trigger AS $$
DECLARE
  parent_status text;
BEGIN
  SELECT status INTO parent_status FROM invoices
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
    RAISE EXCEPTION 'invoice lines are locked once the invoice is approved' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN
    RAISE EXCEPTION 'invoice lines cannot move between invoices' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_lock_trg
  BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION invoice_lines_lock();
--> statement-breakpoint
-- Payments and credit note lines are append-only.
CREATE OR REPLACE FUNCTION billing_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payments_append_only
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION billing_append_only();
--> statement-breakpoint
CREATE TRIGGER credit_note_lines_append_only
  BEFORE UPDATE OR DELETE ON credit_note_lines
  FOR EACH ROW EXECUTE FUNCTION billing_append_only();
--> statement-breakpoint
-- Credit notes: only the refund state may change, and only forwards.
CREATE OR REPLACE FUNCTION credit_notes_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit notes cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.number IS DISTINCT FROM OLD.number
    OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.amount_pence IS DISTINCT FROM OLD.amount_pence
    OR NEW.reason IS DISTINCT FROM OLD.reason
    OR NEW.refund_due_pence IS DISTINCT FROM OLD.refund_due_pence
    OR NOT (NEW.refund_state = OLD.refund_state OR (OLD.refund_state = 'awaiting_refund' AND NEW.refund_state = 'refunded')) THEN
    RAISE EXCEPTION 'credit note % is locked', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER credit_notes_lock_trg
  BEFORE UPDATE OR DELETE ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION credit_notes_lock();
--> statement-breakpoint
INSERT INTO document_sequences (key, next_value) VALUES ('invoice', 1), ('credit_note', 1)
  ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
-- Business details start blank; the Owner fills them in before the first invoice is sent (D1, D51).
INSERT INTO business_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
