-- Reference data for onboarding (D31) and the placeholder terms (D34).
INSERT INTO compliance_requirements (key, label, description, kind, mandatory, blocks_booking, sort_order) VALUES
  ('vaccination_core', 'Core vaccinations', 'Distemper, hepatitis and parvovirus (DHP), from a vet-signed certificate or record card.', 'vaccination', true, true, 10),
  ('vaccination_leptospirosis', 'Leptospirosis vaccination', 'From a vet-signed certificate or record card.', 'vaccination', true, true, 20),
  ('vaccination_kennel_cough', 'Kennel cough vaccination', 'From a vet-signed certificate or record card.', 'vaccination', true, true, 30),
  ('vet_details', 'Vet details', 'The practice that looks after your dog.', 'vet_details', true, true, 40),
  ('emergency_contact', 'Emergency contact', 'At least one person we can call if we cannot reach you.', 'emergency_contact', true, true, 50),
  ('onboarding_form', 'Onboarding form', 'Health, behaviour and permissions for your dog.', 'onboarding_form', true, true, 60),
  ('terms', 'Terms and conditions', 'Read and accept the current LunaK9 Club terms.', 'terms', true, true, 70),
  ('meet_and_greet', 'Meet and greet', 'A short visit so we can get to know your dog.', 'assessment', true, true, 80),
  ('trial_day', 'Trial day', 'A paid first day to make sure your dog is happy with us.', 'assessment', true, true, 90)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO policy_versions (policy_key, version, title, body) VALUES
  ('terms', 1, 'LunaK9 Club terms and conditions (placeholder)',
   E'PLACEHOLDER — these are not the real terms.\n\nLunaK9 Club will replace this text with terms reviewed by a solicitor before launch. They will cover bookings and cancellations (48 hours'' notice), payment, collection and taxi, vaccinations and health, behaviour, incidents and emergency vet treatment, photos, and how we use your information.')
ON CONFLICT DO NOTHING;
