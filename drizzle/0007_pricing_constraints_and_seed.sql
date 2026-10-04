-- Price books never overlap (D44).
ALTER TABLE price_books ADD CONSTRAINT price_books_no_overlap
  EXCLUDE USING gist (daterange(effective_from, effective_to, '[]') WITH &&);
--> statement-breakpoint
-- booking_dogs.membership_id → memberships (declared here to avoid a circular schema import).
ALTER TABLE booking_dogs ADD CONSTRAINT booking_dogs_membership_id_fk
  FOREIGN KEY (membership_id) REFERENCES memberships(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE booking_dogs ADD CONSTRAINT booking_dogs_membership_kind_chk
  CHECK ((kind = 'membership') = (membership_id IS NOT NULL));
--> statement-breakpoint
-- Price snapshots are locked once written (D45).
CREATE OR REPLACE FUNCTION price_snapshots_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'price_snapshots are locked (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER price_snapshots_no_update_delete
  BEFORE UPDATE OR DELETE ON price_snapshots
  FOR EACH ROW EXECUTE FUNCTION price_snapshots_immutable();
--> statement-breakpoint
-- Seed price book from the LunaK9 Club website (checked 26 Sep 2026).
INSERT INTO price_books (name, effective_from, ad_hoc_full_pence, member_low_full_pence, member_high_full_pence, member_high_from_days, half_day_percent, taxi_pence, multi_dog_discount_percent)
SELECT 'Standard prices 2026', '2026-01-01', 5000, 4800, 4500, 4, 50, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM price_books);
