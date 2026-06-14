-- Contactos/redes marcados como favoritos por lead, para seguimiento comercial.
-- Aditivo: array JSONB de { kind, value, marked_by, marked_at }. Default '[]'.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS favorite_contacts jsonb NOT NULL DEFAULT '[]'::jsonb;
