-- F2.7: seed de franchise_names (cadenas reales UY/internacionales). La detección de
-- franquicias ahora es SOLO por esta lista curada; la vieja heurística "mismo nombre en
-- ≥3 direcciones" producía falsos positivos (mutualistas, agencias, nombres comunes de PYME).
INSERT INTO system_lists (list_name, value, scope, source, confidence, reason, enabled) VALUES
  ('franchise_names', 'Abitab', NULL, 'seed', 1.0, 'cadena financiera UY', true),
  ('franchise_names', 'Redpagos', NULL, 'seed', 1.0, 'cadena financiera UY', true),
  ('franchise_names', 'Hertz Rent A Car', NULL, 'seed', 1.0, 'rentadora internacional', true),
  ('franchise_names', 'McDonald''s', NULL, 'seed', 1.0, 'cadena fast food', true),
  ('franchise_names', 'Subway', NULL, 'seed', 1.0, 'cadena fast food', true),
  ('franchise_names', 'KFC', NULL, 'seed', 1.0, 'cadena fast food', true),
  ('franchise_names', 'Burger King', NULL, 'seed', 1.0, 'cadena fast food', true),
  ('franchise_names', 'Starbucks', NULL, 'seed', 1.0, 'cadena café', true),
  ('franchise_names', 'Farmashop', NULL, 'seed', 1.0, 'cadena farmacia UY', true),
  ('franchise_names', 'Farmacenter', NULL, 'seed', 1.0, 'cadena farmacia UY', true),
  ('franchise_names', 'Tienda Inglesa', NULL, 'seed', 1.0, 'supermercado UY', true),
  ('franchise_names', 'Devoto', NULL, 'seed', 1.0, 'supermercado UY', true),
  ('franchise_names', 'Disco', NULL, 'seed', 1.0, 'supermercado UY', true),
  ('franchise_names', 'Ta-Ta', NULL, 'seed', 1.0, 'supermercado UY', true),
  ('franchise_names', 'Ancap', NULL, 'seed', 1.0, 'estación de servicio estatal UY', true),
  ('franchise_names', 'Pronto!', NULL, 'seed', 1.0, 'cadena financiera UY', true),
  ('franchise_names', 'OCA', NULL, 'seed', 1.0, 'cadena financiera UY', true),
  ('franchise_names', 'Creditel', NULL, 'seed', 1.0, 'cadena financiera UY', true),
  ('franchise_names', 'COT', NULL, 'seed', 1.0, 'transporte interurbano UY', true),
  ('franchise_names', 'Cometa', NULL, 'seed', 1.0, 'transporte interurbano UY', true),
  ('franchise_names', 'El Rápido', NULL, 'seed', 1.0, 'transporte interurbano UY', true),
  ('franchise_names', 'COPSA', NULL, 'seed', 1.0, 'transporte interurbano UY', true),
  ('franchise_names', 'Multiahorro', NULL, 'seed', 1.0, 'supermercado UY', true),
  ('franchise_names', 'Macro Mercado', NULL, 'seed', 1.0, 'supermercado UY', true)
ON CONFLICT DO NOTHING;
