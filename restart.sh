#!/usr/bin/env bash
# Reinicia API, UI y mata cualquier proceso CLI activo.
# No toca Supabase.
# El CLI no se auto-reinicia porque requiere argumentos — ejecutarlo manualmente.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$REPO_ROOT/logs"
mkdir -p "$LOGS_DIR"

API_PORT=3001
UI_PORT=3000

# ── helpers ────────────────────────────────────────────────────────────────────

ok()   { echo "  [ok]  $*"; }
act()  { echo "  [→]   $*"; }
info() { echo "  [i]   $*"; }
warn() { echo "  [!]   $*"; }

cli_pids() { pgrep -f "cli/index" 2>/dev/null || true; }

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

kill_pid_file() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    kill -TERM "$pid" 2>/dev/null || true
    rm -f "$pid_file"
  fi
}

echo ""
echo "=== Blindspot — restart (API + UI + CLI) ==="
echo ""

# ── cli: matar procesos activos ────────────────────────────────────────────────

CLI_PIDS=$(cli_pids)
if [ -n "$CLI_PIDS" ]; then
  act "cli — deteniendo pids: $(echo "$CLI_PIDS" | tr '\n' ' ')"
  echo "$CLI_PIDS" | xargs kill -TERM 2>/dev/null || true
  sleep 1
  CLI_PIDS=$(cli_pids)
  [ -n "$CLI_PIDS" ] && echo "$CLI_PIDS" | xargs kill -9 2>/dev/null || true
  ok "cli detenida"
else
  info "cli no estaba corriendo"
fi

# ── api ────────────────────────────────────────────────────────────────────────

act "api — deteniendo (port $API_PORT)..."
kill_port $API_PORT
kill_pid_file "$LOGS_DIR/api.pid"

act "api — levantando..."
pnpm --dir "$REPO_ROOT/api" dev >> "$LOGS_DIR/api.log" 2>&1 &
API_PID=$!
echo "$API_PID" > "$LOGS_DIR/api.pid"
for i in $(seq 1 12); do
  sleep 1
  if nc -z 127.0.0.1 $API_PORT 2>/dev/null; then
    ok "api lista  (pid $API_PID, port $API_PORT)"
    break
  fi
  [ "$i" -eq 12 ] && warn "api no responde aún — Log: $LOGS_DIR/api.log"
done

# ── ui ─────────────────────────────────────────────────────────────────────────

act "ui — deteniendo (port $UI_PORT)..."
kill_port $UI_PORT
kill_pid_file "$LOGS_DIR/ui.pid"

act "ui — levantando..."
pnpm --dir "$REPO_ROOT/ui" dev >> "$LOGS_DIR/ui.log" 2>&1 &
UI_PID=$!
echo "$UI_PID" > "$LOGS_DIR/ui.pid"
ok "ui iniciada  (pid $UI_PID) — disponible en http://localhost:$UI_PORT cuando compile"

# ── resumen ────────────────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────────────────────"
nc -z 127.0.0.1 $API_PORT 2>/dev/null && echo "  api  http://localhost:$API_PORT  ✓" || echo "  api  http://localhost:$API_PORT  (arrancando…)"
echo "  ui   http://localhost:$UI_PORT              (compilando…)"
echo "  cli  inactiva — ejecutar manualmente: pnpm dev <comando>"
echo "─────────────────────────────────────────────"
echo "  logs: $LOGS_DIR/"
echo ""
