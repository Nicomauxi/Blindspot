-- Histórico append-only de actividad social, para graficar crecimiento de seguidores
-- y derivar posts/mes real y churn. NO reemplaza digital_footprint.social_activity
-- (ese sigue siendo el "estado actual" que lee la ficha). 100% aditivo.

CREATE TABLE IF NOT EXISTS social_activity_snapshots (
  lead_id         UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  platform        TEXT        NOT NULL,
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  followers       BIGINT,
  following       BIGINT,
  posts           BIGINT,            -- acumulado total (no posts/mes)
  likes           BIGINT,
  talking_about   BIGINT,
  audience_tier   TEXT,
  activity_status TEXT,
  source          TEXT        NOT NULL DEFAULT 'playwright_public',
  PRIMARY KEY (lead_id, platform, captured_at)
);

CREATE INDEX IF NOT EXISTS social_activity_snapshots_lead_platform_idx
  ON social_activity_snapshots (lead_id, platform, captured_at DESC);
