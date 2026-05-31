#!/usr/bin/env bash
# dev-all.sh — Levanta los tres procesos de Blindspot para desarrollo/demo.
# Uso: ./scripts/dev-all.sh
# Requiere: .env con DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  echo "ERROR: .env no encontrado en $ROOT"
  echo "Copiá .env.example a .env y completá los valores."
  exit 1
fi

# Verificar DATABASE_URL (necesario para pg LISTEN del core)
if ! grep -qE '^DATABASE_URL=.+' "$ROOT/.env"; then
  echo "WARNING: DATABASE_URL no está seteado en .env — el core usará solo polling (sin pg_notify)."
fi

echo "Levantando Blindspot (core + api + ui)..."
echo "  core (PipelineScheduler): node --env-file=.env --import tsx/esm src/start.ts"
echo "  api:                      pnpm --dir api dev"
echo "  ui:                       pnpm --dir ui dev"
echo ""
echo "Ctrl+C para detener todos."

trap 'kill 0' EXIT

# Core (pipeline scheduler + pg LISTEN) — src/start.ts es el worker, NO src/cli/index.ts
(cd "$ROOT" && node --env-file=.env --import tsx/esm src/start.ts 2>&1 | sed 's/^/[core] /') &

# API
(cd "$ROOT" && pnpm --dir api dev 2>&1 | sed 's/^/[api]  /') &

# UI
(cd "$ROOT" && pnpm --dir ui dev 2>&1 | sed 's/^/[ui]   /') &

wait
