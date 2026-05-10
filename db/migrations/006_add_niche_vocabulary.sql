-- Migration 006: niche_vocabulary — dynamic stop-word vocabulary learned from leads

CREATE TABLE IF NOT EXISTS niche_vocabulary (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  niche      text NOT NULL,
  word       text NOT NULL,
  count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  source     text NOT NULL CHECK (source IN ('seed', 'computed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (niche, word)
);

CREATE INDEX IF NOT EXISTS niche_vocabulary_niche_idx ON niche_vocabulary(niche);

-- Invariant enforced by application: rows where source='computed' NEVER have niche='all'.
-- Only 'seed' rows may use niche='all' (universal stop-words applied to every niche).

-- Universal seed stop-words (safe across all niches).
INSERT INTO niche_vocabulary (niche, word, count, source) VALUES
  ('all', 'center',    0, 'seed'),
  ('all', 'centre',    0, 'seed'),
  ('all', 'centro',    0, 'seed'),
  ('all', 'studio',    0, 'seed'),
  ('all', 'estudio',   0, 'seed'),
  ('all', 'group',     0, 'seed'),
  ('all', 'grupo',     0, 'seed'),
  ('all', 'servicios', 0, 'seed'),
  ('all', 'service',   0, 'seed'),
  ('all', 'services',  0, 'seed'),
  ('all', 'soluciones',0, 'seed'),
  ('all', 'solutions', 0, 'seed'),
  ('all', 'uruguay',   0, 'seed'),
  ('all', 'uruguaya',  0, 'seed'),
  ('all', 'uruguayo',  0, 'seed'),
  ('all', 'mvd',       0, 'seed'),
  ('all', 'montevideo',0, 'seed')
ON CONFLICT (niche, word) DO NOTHING;
