#!/bin/bash
set -euo pipefail

PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

RESTORE_FILE="${BLINDSPOT_RESTORE_FILE:-}"
CONTAINER="${BLINDSPOT_DB_CONTAINER:-supabase_db_gap-radar}"
REPO_ROOT="${BLINDSPOT_REPO_ROOT:-$(pwd)}"
VERSIONS_FILE="$(mktemp)"

cleanup() {
  rm -f "$VERSIONS_FILE"
}
trap cleanup EXIT

run_psql() {
  docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

if [ -z "$RESTORE_FILE" ]; then
  echo "ERROR: restore file no especificado" >&2
  exit 1
fi

if [ ! -f "$RESTORE_FILE" ]; then
  echo "ERROR: restore file no existe: $RESTORE_FILE" >&2
  exit 1
fi

if [ ! -r "$RESTORE_FILE" ]; then
  echo "ERROR: restore file sin permisos de lectura: $RESTORE_FILE" >&2
  exit 1
fi

if ! gunzip -t "$RESTORE_FILE"; then
  echo "ERROR: restore file corrupto: $RESTORE_FILE" >&2
  exit 1
fi

run_psql <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'postgres'
  AND pid <> pg_backend_pid();

DROP PUBLICATION IF EXISTS supabase_realtime;

DROP SCHEMA IF EXISTS _realtime CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;
DROP SCHEMA IF EXISTS extensions CASCADE;
DROP SCHEMA IF EXISTS graphql CASCADE;
DROP SCHEMA IF EXISTS graphql_public CASCADE;
DROP SCHEMA IF EXISTS pgbouncer CASCADE;
DROP SCHEMA IF EXISTS realtime CASCADE;
DROP SCHEMA IF EXISTS storage CASCADE;
DROP SCHEMA IF EXISTS supabase_functions CASCADE;
DROP SCHEMA IF EXISTS supabase_migrations CASCADE;
DROP SCHEMA IF EXISTS vault CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;

CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
SQL

gunzip -c "$RESTORE_FILE" | run_psql

if run_psql -Atqc "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version" > "$VERSIONS_FILE" 2>/dev/null; then
  :
else
  : > "$VERSIONS_FILE"
fi

for migration in "$REPO_ROOT"/supabase/migrations/*.sql; do
  [ -f "$migration" ] || continue

  filename="$(basename "$migration")"
  version="${filename%%_*}"
  name="${filename%.sql}"

  if grep -Fxq "$version" "$VERSIONS_FILE"; then
    continue
  fi

  docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$migration"

  run_psql -c "
    INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
    VALUES ('$version', ARRAY['manual restore replay'], '$name')
    ON CONFLICT (version) DO NOTHING;
  " >/dev/null

  printf '%s\n' "$version" >> "$VERSIONS_FILE"
done

echo "Restore OK: $RESTORE_FILE"
