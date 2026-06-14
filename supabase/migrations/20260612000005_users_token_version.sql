-- N71: no existía ningún mecanismo de revocación de sesiones (el access token ES el
-- refresh token, renovable sin límite). token_version permite invalidar todos los
-- tokens de un usuario incrementando la columna.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;
