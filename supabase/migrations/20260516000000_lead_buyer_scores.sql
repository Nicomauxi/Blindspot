CREATE TABLE lead_buyer_scores (
  lead_id     uuid     NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  buyer_type  text     NOT NULL,
  score       smallint NOT NULL CHECK (score >= 0 AND score <= 100),
  computed_at timestamptz NOT NULL DEFAULT now(),
  breakdown   jsonb,
  PRIMARY KEY (lead_id, buyer_type)
);
CREATE INDEX lead_buyer_scores_type_score ON lead_buyer_scores(buyer_type, score DESC);
