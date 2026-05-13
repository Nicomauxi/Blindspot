-- Add profiles c and d to runs_profile_check constraint
ALTER TABLE runs DROP CONSTRAINT IF EXISTS runs_profile_check;
ALTER TABLE runs ADD CONSTRAINT runs_profile_check
  CHECK (profile IN ('a', 'b', 'c', 'd'));
