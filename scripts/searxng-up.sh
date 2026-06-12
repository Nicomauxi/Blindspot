#!/usr/bin/env bash
# Levanta SearXNG estable para el enriquecimiento IG ($0, local-only). Ver R.4 del plan.
# Reemplaza el contenedor efímero `searxng-poc` por uno con --restart unless-stopped
# y la config versionada en config/searxng/.
#
# Uso: bash scripts/searxng-up.sh
# Verificación: curl -s "http://localhost:8080/search?q=test&format=json" | head -c 100
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="$REPO_ROOT/config/searxng"
NAME="searxng"
PORT="${SEARXNG_PORT:-8080}"

if [ ! -f "$CONFIG_DIR/settings.yml" ]; then
  echo "ERROR: falta $CONFIG_DIR/settings.yml" >&2
  exit 1
fi

# Reemplazo idempotente: si ya existe un contenedor con este nombre, recrearlo.
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "Removiendo contenedor previo '$NAME'..."
  docker rm -f "$NAME" >/dev/null
fi

echo "Levantando '$NAME' en :$PORT ..."
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  -p "$PORT:8080" \
  -v "$CONFIG_DIR:/etc/searxng" \
  searxng/searxng >/dev/null

echo "Esperando readiness..."
for i in $(seq 1 30); do
  if curl -fs "http://localhost:$PORT/search?q=test&format=json" >/dev/null 2>&1; then
    echo "OK: SearXNG JSON API responde en http://localhost:$PORT"
    exit 0
  fi
  sleep 1
done

echo "WARN: el contenedor arrancó pero la API JSON no respondió en 30s. Revisar 'docker logs $NAME'." >&2
exit 1
