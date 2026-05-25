-- niche_aliases: admin-managed synonym groups for lead niche values.
-- When a filter specifies a niche, all members of its group are matched.
CREATE TABLE niche_aliases (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical  text        NOT NULL UNIQUE,
  aliases    text[]      NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_niche_aliases_aliases ON niche_aliases USING GIN (aliases);
