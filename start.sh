#!/usr/bin/env bash
# Levanta solo los servicios que están abajo.
# No reinicia ni toca lo que ya esté corriendo.
# CLI: no se auto-inicia (requiere argumentos), solo se reporta su estado.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$REPO_ROOT/logs"
mkdir -p "$LOGS_DIR"

SUPABASE_PORT=54401
API_PORT=3001
UI_PORT=3000

# ── helpers ────────────────────────────────────────────────────────────────────

port_up() { nc -z 127.0.0.1 "$1" 2>/dev/null; }

cli_pids() { pgrep -f "cli/index" 2>/dev/null || true; }

ok()   { echo "  [ok]  $*"; }
up()   { echo "  [↑]   $*"; }
info() { echo "  [i]   $*"; }
warn() { echo "  [!]   $*"; }

# ── supabase ───────────────────────────────────────────────────────────────────

echo ""
echo "=== Blindspot — start ==="
echo ""

if port_up $SUPABASE_PORT; then
  ok "supabase ya está corriendo  (port $SUPABASE_PORT)"
else
  up "supabase — levantando..."
  cd "$REPO_ROOT"
  pnpm supabase start 2>&1 | grep -E "Started|Error|URL|Stopped" || true
  if port_up $SUPABASE_PORT; then
    ok "supabase lista"
  else
    warn "supabase no responde en port $SUPABASE_PORT — revisar con: pnpm supabase status"
  fi
fi

# ── api (fastify) ──────────────────────────────────────────────────────────────

if port_up $API_PORT; then
  ok "api ya está corriendo  (port $API_PORT)"
else
  up "api — levantando..."
  pnpm --dir "$REPO_ROOT/api" dev >> "$LOGS_DIR/api.log" 2>&1 &
  API_PID=$!
  echo "$API_PID" > "$LOGS_DIR/api.pid"
  for i in $(seq 1 12); do
    sleep 1
    if port_up $API_PORT; then
      ok "api lista  (pid $API_PID, port $API_PORT)"
      break
    fi
    [ "$i" -eq 12 ] && warn "api no responde aún — Log: $LOGS_DIR/api.log"
  done
fi

# ── ui (next.js) ───────────────────────────────────────────────────────────────

if port_up $UI_PORT; then
  ok "ui ya está corriendo  (port $UI_PORT)"
else
  up "ui — levantando (compilación en background)..."
  pnpm --dir "$REPO_ROOT/ui" dev >> "$LOGS_DIR/ui.log" 2>&1 &
  UI_PID=$!
  echo "$UI_PID" > "$LOGS_DIR/ui.pid"
  ok "ui iniciada  (pid $UI_PID) — disponible en http://localhost:$UI_PORT cuando compile"
fi

# ── cli (one-shot) ─────────────────────────────────────────────────────────────

CLI_PIDS=$(cli_pids)
if [ -n "$CLI_PIDS" ]; then
  info "cli corriendo  (pids: $(echo "$CLI_PIDS" | tr '\n' ' '))"
else
  info "cli inactiva — ejecutar manualmente:  pnpm dev <comando>"
fi

# ── resumen ────────────────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────────────────────"
port_up $SUPABASE_PORT && echo "  supabase  http://127.0.0.1:$SUPABASE_PORT  ✓" || echo "  supabase  ✗"
port_up $API_PORT      && echo "  api       http://localhost:$API_PORT        ✓" || echo "  api       http://localhost:$API_PORT        (arrancando…)"
port_up $UI_PORT       && echo "  ui        http://localhost:$UI_PORT         ✓" || echo "  ui        http://localhost:$UI_PORT         (compilando…)"
[ -n "$(cli_pids)" ]   && echo "  cli       corriendo" || echo "  cli       inactiva"
echo "─────────────────────────────────────────────"
echo "  logs: $LOGS_DIR/"
echo ""
