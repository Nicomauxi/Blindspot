-- Fresh-install seed for local development and minimum E2E.
-- Passwords are local-only and must be replaced outside development.

INSERT INTO users (email, password_hash, role, lead_filter, active)
VALUES (
  'admin@blindspot.local',
  crypt('admin_local_2026', gen_salt('bf', 12)),
  'admin',
  NULL,
  true
)
ON CONFLICT (email) DO UPDATE
SET role = EXCLUDED.role,
    active = EXCLUDED.active;

INSERT INTO users (email, password_hash, role, lead_filter, active)
VALUES (
  'cm@blindspot.local',
  crypt('cm_local_2026', gen_salt('bf', 12)),
  'cm',
  '{"contact_tier":["A","B","C","D"],"exclude_franchises":false}'::jsonb,
  true
)
ON CONFLICT (email) DO UPDATE
SET role = EXCLUDED.role,
    lead_filter = EXCLUDED.lead_filter,
    active = EXCLUDED.active;

INSERT INTO backup_config (id)
VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

INSERT INTO service_pricing (user_id, service_type, monthly_fee, notes)
SELECT
  u.id,
  s.service_type,
  s.monthly_fee,
  s.notes
FROM users u
CROSS JOIN (VALUES
  ('delivery_system', 3000, 'Sistema propio de delivery'),
  ('website_basic', 1500, 'Sitio web básico'),
  ('website_standard', 2500, 'Sitio web estándar'),
  ('website_premium', 5000, 'Sitio web premium'),
  ('pos_system', 2000, 'Sistema POS'),
  ('reservation_system', 1800, 'Sistema de reservas online')
) AS s(service_type, monthly_fee, notes)
WHERE u.role = 'admin'
ON CONFLICT (user_id, service_type) DO NOTHING;
