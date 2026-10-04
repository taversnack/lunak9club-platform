-- Foreign keys declared here to avoid circular schema imports.
ALTER TABLE checkout_attempts ADD CONSTRAINT checkout_attempts_booking_id_fk
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE payments ADD CONSTRAINT payments_checkout_attempt_id_fk
  FOREIGN KEY (checkout_attempt_id) REFERENCES checkout_attempts(id) ON DELETE RESTRICT;
--> statement-breakpoint
-- Card refunds can't be deleted, and their amount and payment never change.
CREATE OR REPLACE FUNCTION card_refunds_lock() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'card refunds cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.amount_pence IS DISTINCT FROM OLD.amount_pence
    OR NEW.payment_id IS DISTINCT FROM OLD.payment_id
    OR NEW.credit_note_id IS DISTINCT FROM OLD.credit_note_id
    OR (OLD.status = 'succeeded' AND NEW.status <> 'succeeded') THEN
    RAISE EXCEPTION 'card refund % is locked', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER card_refunds_lock_trg
  BEFORE UPDATE OR DELETE ON card_refunds
  FOR EACH ROW EXECUTE FUNCTION card_refunds_lock();
