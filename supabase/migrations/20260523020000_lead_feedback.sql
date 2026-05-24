CREATE TABLE IF NOT EXISTS lead_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  field_value jsonb,
  verdict text NOT NULL CHECK (verdict IN ('good', 'bad')),
  comment text,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_feedback_lead_created_at_idx
  ON lead_feedback(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS lead_feedback_lead_field_idx
  ON lead_feedback(lead_id, field_key, created_at DESC);

CREATE INDEX IF NOT EXISTS lead_feedback_actor_idx
  ON lead_feedback(actor_user_id, created_at DESC);
