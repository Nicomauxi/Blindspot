-- Nueva fuente de discovery: MIEM DEI (Directorio de Empresas Industriales, dato abierto).
-- Aditivo: extiende los CHECK de `source` para aceptar 'miem_dei' en leads y en las
-- referencias de corroboración cross-source. No toca filas existentes.
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (
  source = ANY (ARRAY[
    'google_places'::text, 'mintur'::text, 'pedidosya'::text, 'imm_habilitaciones'::text,
    'yelu'::text, 'osm'::text, 'infonegocios'::text, 'dgi'::text, 'miem_dei'::text
  ])
);

ALTER TABLE lead_source_references DROP CONSTRAINT IF EXISTS lead_source_references_source_check;
ALTER TABLE lead_source_references ADD CONSTRAINT lead_source_references_source_check CHECK (
  source = ANY (ARRAY[
    'google_places'::text, 'mintur'::text, 'pedidosya'::text, 'imm_habilitaciones'::text,
    'yelu'::text, 'osm'::text, 'infonegocios'::text, 'dgi'::text, 'miem_dei'::text
  ])
);
