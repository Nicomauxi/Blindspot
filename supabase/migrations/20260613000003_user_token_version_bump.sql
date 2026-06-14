-- MA-01: la revocación de sesión server-side (middleware compara token.tv contra
-- users.token_version) estaba MUERTA: ningún endpoint/trigger/RPC incrementaba jamás
-- token_version, así que ambos lados valían 0 y la condición nunca se cumplía. En particular,
-- un reset de password NO invalidaba los tokens ya emitidos (válidos ~30 días).
-- Este RPC bumpea token_version atómicamente; se invoca al resetear password (revoca tokens
-- vigentes) y desde un futuro "cerrar todas las sesiones".
CREATE OR REPLACE FUNCTION public.bump_user_token_version(p_user_id uuid)
RETURNS integer
LANGUAGE sql
AS $function$
  UPDATE public.users
  SET token_version = COALESCE(token_version, 0) + 1
  WHERE id = p_user_id
  RETURNING token_version;
$function$;
