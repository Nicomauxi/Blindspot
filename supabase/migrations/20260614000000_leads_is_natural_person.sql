-- Ley 18.331: marca de persona física (empresa unipersonal = datos personales del individuo).
-- Los leads marcados se ocultan del pool (passed_filter=false) y se les minimizan los datos
-- personales (teléfono/dirección/footprint), conservando solo lo mínimo para NO reprocesarlos
-- (place_id/external_id/source/name público + este flag). Aditivo, no toca filas existentes.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_natural_person boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN leads.is_natural_person IS
  'Ley 18.331: el lead es (probable) persona física. Se oculta del pool y se le minimizan los datos personales. Fuente: heurística de nombre (person-classifier) o, a futuro, tipo de entidad DGI.';
