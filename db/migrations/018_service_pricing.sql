-- Fase 27: service_pricing tabla por usuario con seed para admin
-- Prerequisito de Fase 13 (PedidosYa escape) y generación de ofertas.

BEGIN;

CREATE TABLE IF NOT EXISTS service_pricing (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_type  text NOT NULL,
  monthly_fee   integer NOT NULL CHECK (monthly_fee >= 0),
  currency      text NOT NULL DEFAULT 'UYU',
  notes         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, service_type)
);

CREATE INDEX service_pricing_user_id       ON service_pricing(user_id);
CREATE INDEX service_pricing_service_type  ON service_pricing(service_type);

CREATE TRIGGER service_pricing_updated_at BEFORE UPDATE ON service_pricing
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed: price entries for the admin user for common service types.
-- Monthly fees are examples (UYU) — admin updates them to match their actual pricing.
INSERT INTO service_pricing (user_id, service_type, monthly_fee, notes)
SELECT
  u.id,
  s.service_type,
  s.monthly_fee,
  s.notes
FROM users u
CROSS JOIN (VALUES
  ('delivery_system',  3000,  'Sistema propio de delivery (ej. Pedidos-Ya independiente)'),
  ('website_basic',    1500,  'Sitio web básico con formulario de contacto'),
  ('website_standard', 2500,  'Sitio web estándar con SEO básico'),
  ('website_premium',  5000,  'Sitio web premium con analytics y integración'),
  ('pos_system',       2000,  'Sistema POS básico'),
  ('reservation_system', 1800, 'Sistema de reservas online')
) AS s(service_type, monthly_fee, notes)
WHERE u.role = 'admin'
ON CONFLICT (user_id, service_type) DO NOTHING;

COMMIT;
