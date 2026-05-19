#!/bin/bash
set -euo pipefail

PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BLINDSPOT_BACKUP_DIR:-$HOME/blindspot-backups}"
CONTAINER="${BLINDSPOT_DB_CONTAINER:-supabase_db_gap-radar}"
BACKUP_TAG="${BACKUP_TAG:-}"

BACKUP_NAME="blindspot_${TIMESTAMP}.sql.gz"
if [ -n "$BACKUP_TAG" ]; then
  BACKUP_NAME="blindspot_${BACKUP_TAG}_${TIMESTAMP}.sql.gz"
fi

BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

cleanup_partial_backup() {
  local exit_code=$?
  if [ "$exit_code" -ne 0 ] && [ -f "$BACKUP_PATH" ]; then
    rm -f "$BACKUP_PATH"
  fi

  exit "$exit_code"
}

trap cleanup_partial_backup EXIT

mkdir -p "$BACKUP_DIR"

docker exec "$CONTAINER" pg_dump -U postgres -d postgres | gzip > "$BACKUP_PATH"

if ! gunzip -t "$BACKUP_PATH"; then
  echo "ERROR: backup corrupto, eliminando" >&2
  rm -f "$BACKUP_PATH"
  exit 1
fi

SIZE=$(stat -c%s "$BACKUP_PATH")
if [ "$SIZE" -lt 10240 ]; then
  echo "ERROR: backup demasiado pequeño ($SIZE bytes), eliminando" >&2
  rm -f "$BACKUP_PATH"
  exit 1
fi

find "$BACKUP_DIR" -type f -name "blindspot_*.sql.gz" -mtime +7 -delete

trap - EXIT
echo "Backup OK: $BACKUP_PATH ($SIZE bytes)"
