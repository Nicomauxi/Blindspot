#!/usr/bin/env bash
# Resetea la base de datos local y corre todas las migraciones desde cero.
# DESTRUCTIVO — borra todos los datos locales.
# Detiene el CLI y la API antes del reset para liberar conexiones DB.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$REPO_ROOT/logs"
mkdir -p "$LOGS_DIR"

SUPABASE_PORT=54401
API_PORT=3001

port_up()  { nc -z 127.0.0.1 "$1" 2>/dev/null; }
cli_pids() { pgrep -f "cli/index" 2>/dev/null || true; }

ok()   { echo "  [ok]  $*"; }
act()  { echo "  [→]   $*"; }
info() { echo "  [i]   $*"; }
warn() { echo "  [!]   $*"; }

kill_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | xargs kill -TERM 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

echo ""
echo "=== Blindspot — reset DB ==="
echo ""

# Verificar que Supabase esté corriendo; si no, levantarlo primero
if ! port_up $SUPABASE_PORT; then
  act "Supabase no está corriendo — levantando..."
  cd "$REPO_ROOT"
  pnpm supabase start 2>&1 | grep -E "Started|Error|URL" || true
  if ! port_up $SUPABASE_PORT; then
    warn "ERROR: no se pudo levantar Supabase. Abortando."
    exit 1
  fi
fi

echo "  [!]  Esto borrará todos los datos locales y recorrerá las migraciones."
echo "       Presioná Enter para continuar o Ctrl+C para cancelar."
read -r

# ── detener CLI para liberar conexiones ────────────────────────────────────────

CLI_PIDS=$(cli_pids)
if [ -n "$CLI_PIDS" ]; then
  act "cli — deteniendo antes del reset..."
  echo "$CLI_PIDS" | xargs kill -TERM 2>/dev/null || true
  sleep 1
  CLI_PIDS=$(cli_pids)
  [ -n "$CLI_PIDS" ] && echo "$CLI_PIDS" | xargs kill -9 2>/dev/null || true
  ok "cli detenida"
else
  info "cli no estaba corriendo"
fi

# ── detener API para liberar conexiones ───────────────────────────────────────

API_WAS_UP=false
if port_up $API_PORT; then
  API_WAS_UP=true
  act "api — deteniendo para liberar conexiones DB..."
  kill_port $API_PORT
  if [ -f "$LOGS_DIR/api.pid" ]; then
    kill -TERM "$(cat "$LOGS_DIR/api.pid")" 2>/dev/null || true
  fi
  ok "api detenida"
fi

# ── reset ──────────────────────────────────────────────────────────────────────

cd "$REPO_ROOT"
pnpm supabase db reset

ok "DB reseteada y migraciones aplicadas."

# ── relanzar API si estaba corriendo ──────────────────────────────────────────

if [ "$API_WAS_UP" = true ]; then
  act "api — relanzando..."
  pnpm --dir "$REPO_ROOT/api" dev >> "$LOGS_DIR/api.log" 2>&1 &
  API_PID=$!
  echo "$API_PID" > "$LOGS_DIR/api.pid"
  for i in $(seq 1 12); do
    sleep 1
    if port_up $API_PORT; then
      ok "api relanzada  (pid $API_PID)"
      break
    fi
    [ "$i" -eq 12 ] && warn "api no responde aún — Log: $LOGS_DIR/api.log"
  done
fi

echo ""
echo "─────────────────────────────────────────────"
echo "  Studio: http://127.0.0.1:54403"
port_up $API_PORT && echo "  api:    http://localhost:$API_PORT  ✓" || echo "  api:    detenida (no estaba corriendo antes)"
echo "  cli:    inactiva — ejecutar manualmente: pnpm dev <comando>"
echo "─────────────────────────────────────────────"
echo ""
