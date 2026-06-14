-- Razón estructurada al marcar un dato/contacto como incorrecto, y reasignación opcional
-- a otro lead (señal auditada, NO muta el lead destino). Ambas columnas nullable/aditivas.
ALTER TABLE lead_feedback
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reassign_to_lead_id uuid REFERENCES leads(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lead_feedback_rejection_reason_check'
  ) THEN
    ALTER TABLE lead_feedback
      ADD CONSTRAINT lead_feedback_rejection_reason_check
      CHECK (rejection_reason IS NULL OR rejection_reason IN (
        'no_pertenece_al_lead', 'dato_desactualizado', 'fuera_de_servicio', 'otro'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS lead_feedback_reassign_idx
  ON lead_feedback (reassign_to_lead_id) WHERE reassign_to_lead_id IS NOT NULL;
