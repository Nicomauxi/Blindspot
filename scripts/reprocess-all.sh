#!/usr/bin/env bash
# Reproceso total de enriquecimiento (flujos gratis, SIN discovery/Google).
# Cada etapa es best-effort: un fallo no bloquea las siguientes (se audita al final).
set -uo pipefail
cd /home/nicolasfalcioni/Documentos/blindspot

log() { echo "=== $1 — $(date '+%F %T') ==="; }
run() { "$@" && log "OK $1" || log "FALLO (continuo)"; }

NODE="node --env-file=.env --import tsx/esm"

log "REPROCESS START"

log "1/4 ENRICH (heuristic + HTML + WHOIS + inferred-state) START"
$NODE src/cli/index.ts enrich --all --with-heuristic --force-refresh --concurrency 16 \
  && log "1/4 ENRICH DONE" || log "1/4 ENRICH FALLO (continuo)"

log "2/4 SOCIAL-ENRICH (actividad + liveness) START"
SOCIAL_ENRICH_CONCURRENCY=4 $NODE src/cli/index.ts social-enrich --all --force --limit 8000 \
  && log "2/4 SOCIAL-ENRICH DONE" || log "2/4 SOCIAL-ENRICH FALLO (continuo)"

log "3/4 CLEANUP redes muertas START"
$NODE scripts/cleanup-dead-social-urls.ts --apply \
  && log "3/4 CLEANUP DONE" || log "3/4 CLEANUP FALLO (continuo)"

log "4/4 SCORE (re-score + buyer-types) START"
$NODE src/cli/index.ts score --all --buyer-types \
  && log "4/4 SCORE DONE" || log "4/4 SCORE FALLO (continuo)"

log "REPROCESS ALL DONE"
