-- England & Wales bank holidays 2029-2031 (0005 seeded them up to 2028).
-- gov.uk (https://www.gov.uk/bank-holidays.json) only publishes up to 26 Dec 2028, so these dates are
-- COMPUTED from the standing rules: New Year's Day, Good Friday and Easter Monday (Gregorian Easter),
-- first and last Monday in May, last Monday in August, Christmas Day and Boxing Day, each moved to the
-- next weekday when it falls on a weekend (no substitute days are needed in 2029-2031). Check them
-- against gov.uk once it publishes these years; one-off holidays (e.g. a coronation) aren't predictable.
INSERT INTO closures (service_date, reason) VALUES
  ('2029-01-01', 'New Year''s Day'), ('2029-03-30', 'Good Friday'), ('2029-04-02', 'Easter Monday'),
  ('2029-05-07', 'Early May bank holiday'), ('2029-05-28', 'Spring bank holiday'), ('2029-08-27', 'Summer bank holiday'),
  ('2029-12-25', 'Christmas Day'), ('2029-12-26', 'Boxing Day'),
  ('2030-01-01', 'New Year''s Day'), ('2030-04-19', 'Good Friday'), ('2030-04-22', 'Easter Monday'),
  ('2030-05-06', 'Early May bank holiday'), ('2030-05-27', 'Spring bank holiday'), ('2030-08-26', 'Summer bank holiday'),
  ('2030-12-25', 'Christmas Day'), ('2030-12-26', 'Boxing Day'),
  ('2031-01-01', 'New Year''s Day'), ('2031-04-11', 'Good Friday'), ('2031-04-14', 'Easter Monday'),
  ('2031-05-05', 'Early May bank holiday'), ('2031-05-26', 'Spring bank holiday'), ('2031-08-25', 'Summer bank holiday'),
  ('2031-12-25', 'Christmas Day'), ('2031-12-26', 'Boxing Day')
ON CONFLICT (service_date) DO NOTHING;
