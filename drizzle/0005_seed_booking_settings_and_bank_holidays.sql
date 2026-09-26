-- Default operating settings (D7, D23, D26, D37) and England & Wales bank holidays from GOV.UK (to end of 2028).
INSERT INTO booking_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
INSERT INTO closures (service_date, reason) VALUES
  ('2026-12-25', 'Christmas Day'), ('2026-12-28', 'Boxing Day (substitute day)'),
  ('2027-01-01', 'New Year''s Day'), ('2027-03-26', 'Good Friday'), ('2027-03-29', 'Easter Monday'),
  ('2027-05-03', 'Early May bank holiday'), ('2027-05-31', 'Spring bank holiday'), ('2027-08-30', 'Summer bank holiday'),
  ('2027-12-27', 'Christmas Day (substitute day)'), ('2027-12-28', 'Boxing Day (substitute day)'),
  ('2028-01-03', 'New Year''s Day (substitute day)'), ('2028-04-14', 'Good Friday'), ('2028-04-17', 'Easter Monday'),
  ('2028-05-01', 'Early May bank holiday'), ('2028-05-29', 'Spring bank holiday'), ('2028-08-28', 'Summer bank holiday'),
  ('2028-12-25', 'Christmas Day'), ('2028-12-26', 'Boxing Day')
ON CONFLICT (service_date) DO NOTHING;
