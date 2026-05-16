# Blindspot — Future

> Solo contiene lo que NO está hecho todavía.
> Al completar un item → borrarlo.
> Al agregar un objetivo nuevo → insertarlo en el lugar correcto por prioridad.

---

## Urgente — Bloqueantes para el valor del producto

> Ejecutar en este orden. Fase 19 eliminada — era un stopgap innecesario, Fase 22 la reemplaza completamente.
> Ver `ARCHITECTURE_FUTURE.md` para el diseño objetivo completo de scoring, contactabilidad y pitch.

### Fase 22-pre — `scoring_version` field (PREREQUISITO de Fase 22, ~30 min)

**Por qué:** sin este campo, al desplegar Scoring v2 y re-scorear todos los leads, no hay forma de distinguir scores v1 de v2 si el proceso falla a mitad. Hacerlo antes de cualquier cambio de fórmula.

**Implementación:**
1. Migración: `ALTER TABLE leads ADD COLUMN scoring_version smallint NOT NULL DEFAULT 1;`
2. Migración: `ALTER TABLE lead_buyer_scores ADD COLUMN scoring_version smallint NOT NULL DEFAULT 1;`
3. Backfill ya cubierto por el `DEFAULT 1` — verificar: `SELECT COUNT(*) FROM leads WHERE scoring_version IS NULL;` debe ser 0.
4. Al desplegar Scoring v2: el comando `score --all` setea `scoring_version = 2` en cada row actualizada.

**Tipo `smallint` (no text):** permite comparación numérica (`WHERE scoring_version < 2`) y es más eficiente que texto. Valor 1 = v1, 2 = v2, etc.

**Invariante a agregar (activar post-Fase 22):**
```sql
-- Todos los leads passed deben estar en v2 al terminar
SELECT COUNT(*) FROM leads WHERE passed_filter = true AND scoring_version < 2;
-- Debe ser 0 al terminar score --all

-- Invariante 5 (activar en la sesión de Fase 22):
-- Tier X nunca debe ser hot con la nueva fórmula
SELECT COUNT(*) FROM leads
WHERE score_breakdown->>'contact_tier' = 'X' AND prospect_score >= 55;
-- Debe ser < 5 (tolerar mínimas excepciones de datos edge)
```

---

### Fase 22 — Scoring v2 completo

**Por qué:** la fórmula actual tiene 6 problemas concretos con datos: leads incontactables como hot, corroboration inversamente correlacionada, niche "other" invisible, franquicias con mayor score que independientes, calidad del negocio ignorada, max() ignora multi-oferta. Ver `ARCHITECTURE_FUTURE.md § Análisis crítico del scoring actual`.

**Prerequisito:** Fase 22-pre (`scoring_version` field) debe estar aplicada antes.

**Fórmula v2:**
```
commercial_score = min(100,
  floor((gap_depth + commercial_breadth + business_quality_pts)
        × accessibility_factor × timing_factor)
  + urgency_bonus
)
```

**Implementación:**
1. `scoring_version = 2` (smallint, no string) en cada row al re-scorear — ver step 13 para la ubicación exacta
2. `gap_depth`: `min(60, max(sub_scores) + source_quality_bonus)`
3. `source_quality_bonus`: mintur=+20, pedidosya=+15, yelu=+10, osm=+8, google_places=0 (en `config/scoring.yaml`)
4. `commercial_breadth`: +8 si 2ª oferta ≥ 30, +4 si 3ª ≥ 30
5. `business_quality_pts`: rating + reviews + data_confidence + corroboration, cap 15
6. `accessibility_factor`: X=0.30, D=0.65, C=0.90, B=1.15, A=1.30, A+B=1.40
7. `timing_factor`: urgency + new_business + competitive_pressure + franchise_penalty
8. `urgency_bonus`: high=+5, medium=+2
9. Sub-score nuevo `contacto_directo` (cap 40) en `scoring/sub-scores.ts`: phone verificado + niche activo + sin plataformas digitales conocidas
10. **`computeContactTier(lead)` → 'A'|'B'|'C'|'D'|'X'** — INCLUIDO EN ESTA FASE (Fase 20 eliminada como fase separada):
    - A: email en `canonical_fields.email.value` O `digital_footprint.contact_emails` (no vacío)
    - B: whatsapp confirmado (y no A) — C: phone (y no A ni B) — D: address — X: nada
11. **`computePitchHook(primary_offer, inferred_state, niche): string`** — nuevo `scoring/pitch.ts`, mapa en `config/scoring.yaml → pitch_hooks`
12. Persistir en `score_breakdown`: `contact_tier`, `pitch_hook`, `source_quality_bonus`, `inferred_state_summary`
13. `scoring_version = 2` en cada row actualizada (leads + lead_buyer_scores)
14. Thresholds nuevos en `config/scoring.yaml`: hot=55, pitcheable=40, pool=25
15. Correr `score --all`

**Archivos:** `src/modules/scoring/index.ts`, `src/modules/scoring/sub-scores.ts`, nuevo `src/modules/scoring/pitch.ts`, `config/scoring.yaml`

**Verificación post-implementación:**
```sql
-- Tier X nunca debe aparecer como hot (< 5 excepciones)
SELECT COUNT(*) FROM leads
WHERE score_breakdown->>'contact_tier' = 'X' AND prospect_score >= 55;

-- Car dealers deben subir: avg > 40 post-v2
SELECT ROUND(AVG(prospect_score),1) FROM leads WHERE niche = 'car_dealer';

-- Franquicias deben bajar a < 20 de promedio (por sus gaps bajos, no solo el penalty)
SELECT ROUND(AVG(prospect_score),1) FROM leads WHERE 'franchise-detected' = ANY(tags);

-- Todos los leads passed deben estar en v2
SELECT COUNT(*) FROM leads WHERE passed_filter = true AND scoring_version < 2;
-- Debe ser 0

-- contact_tier y pitch_hook en todos los leads passed
SELECT COUNT(*) FROM leads WHERE passed_filter=true AND score_breakdown->>'contact_tier' IS NULL;
-- Debe ser 0
```

---

### Fase 20 — ✅ Absorbida por Fase 22

`contact_tier` y `pitch_hook` se implementan dentro del engine de scoring v2 (Fase 22, steps 10-12). No es una fase separada.

---

### Fase 6 — Cross-source deduplication activo (MOVIDA A URGENTE)

**Por qué:** `findCrossSourceMatch` está implementado pero no se llama al insertar leads externos. Resultado: un mismo negocio existe como 3 leads separados en lugar de 1 lead con 3 fuentes corroborantes. `corroborating_sources` queda siempre vacío. `data_confidence_score` nunca sube. Cada nueva fuente que se agrega sin este fix multiplica el ruido. Ver `ARCHITECTURE_FUTURE.md § Cross-source como motor de confianza`.

**Implementación en `src/cli/commands/discover-external.ts`:**
```
// Antes de insertExternalLead(candidate):
const match = findCrossSourceMatch(candidate, allLeads, 0.85)
if (match) {
  await addCorroboratingSource(match.id, { source: candidate.source, external_id: candidate.external_id, ... })
  // reconciliar canonical_fields: phone, email, website
  // recalcular data_confidence_score
} else {
  await insertExternalLead(candidate)
}
```

**Archivos:** `src/cli/commands/discover-external.ts`, `src/storage/external-leads.ts`, `src/modules/discovery/deduplication.ts`

**Paso crítico post-implementación — reconciliación retroactiva:**
El fix solo deduplica runs NUEVOS. Los ~4.800 leads existentes siguen siendo duplicados hasta que se re-corra discovery sobre las fuentes existentes. Al terminar la implementación:
```bash
# Re-correr discovery para cada fuente activa para consolidar duplicados existentes
blindspot discover-external --source mintur --dry-run   # verificar antes
blindspot discover-external --source osm --location montevideo --niche restaurant
blindspot discover-external --source yelu --location montevideo
# ... resto de fuentes y zonas
# Después re-scorear para actualizar contact_tier con canonical_fields ahora poblados:
blindspot score --all
```

**Verificación:**
```sql
-- Debe haber leads con corroborating_sources no vacío post-reconciliación
SELECT COUNT(*) FROM leads WHERE jsonb_array_length(corroborating_sources) > 0;
-- El COUNT(*) total de leads debe haber BAJADO (duplicados fusionados)
SELECT COUNT(*) FROM leads;
-- contact_tier debe estar más preciso post canonical_fields
SELECT contact_tier, COUNT(*) FROM leads
CROSS JOIN LATERAL jsonb_extract_path_text(score_breakdown, 'contact_tier') contact_tier
WHERE passed_filter = true GROUP BY 1 ORDER BY 1;
```

---

### Fase — `inferred_state` → columna propia (DEUDA ALTA → ejecutar antes de UI, después de Fase 6)

**Por qué:** la UI filtrará por `digitalization_level`, `has_delivery`, `has_pos`. Sin columna propia, cada query hace JSON parsing en tabla completa. Con columna propia se puede indexar. Hacerlo antes de escribir cualquier endpoint de filtrado. Ver `ARCHITECTURE_FUTURE.md § inferred_state como columna propia`.

**Implementación:**
1. `ALTER TABLE leads ADD COLUMN inferred_state jsonb;`
2. `UPDATE leads SET inferred_state = digital_footprint->'inferred_state' WHERE digital_footprint->'inferred_state' IS NOT NULL;`
3. Índices:
   ```sql
   CREATE INDEX leads_digitalization_level ON leads ((inferred_state->>'digitalization_level'));
   CREATE INDEX leads_has_delivery ON leads ((inferred_state->'has_delivery'->>'value'));
   CREATE INDEX leads_has_pos ON leads ((inferred_state->'has_pos'->>'value'));
   ```
4. Actualizar todos los accesos en código: `digital_footprint->'inferred_state'` → `inferred_state`
5. Eliminar `inferred_state` del JSONB `digital_footprint` (UPDATE en lotes de 500 — destructivo, sin rollback):
   ```sql
   -- Verificar ANTES de eliminar:
   SELECT COUNT(*) FROM leads WHERE inferred_state IS NOT NULL; -- debe ser > 0
   -- Luego eliminar en lotes:
   WITH batch AS (SELECT id FROM leads WHERE digital_footprint->'inferred_state' IS NOT NULL LIMIT 500)
   UPDATE leads SET digital_footprint = digital_footprint - 'inferred_state'
   WHERE id IN (SELECT id FROM batch);
   -- Repetir hasta: SELECT COUNT(*) FROM leads WHERE digital_footprint->'inferred_state' IS NOT NULL; = 0
   ```

**Verificación:**
```sql
SELECT COUNT(*) FROM leads WHERE inferred_state IS NOT NULL;
-- Debe coincidir con el count anterior de digital_footprint->'inferred_state' IS NOT NULL
SELECT COUNT(*) FROM leads WHERE digital_footprint->'inferred_state' IS NOT NULL;
-- Debe ser 0 cuando terminen los lotes
```

---

### Fase 21 — PostGIS activation (infra, ~30 min, desbloquea 3 features)

**Por qué:** tenemos coordenadas GPS en prácticamente todos los leads de OSM, muchos de MINTUR y Google Places. Sin PostGIS son columnas decorativas. Con PostGIS se habilitan: competitive density (único sin web en 500m), hot zone clustering (mapa de zonas), turismo proximity (urgency signal automático). Ver `ARCHITECTURE_FUTURE.md § Sub-niche detection` y `§ Señales de valor no capturadas`.

**Implementación:**
1. Activar extensión:
   - **Local:** `CREATE EXTENSION IF NOT EXISTS postgis;` (funciona con `psql` directo)
   - **Cloud Supabase:** via Dashboard → Database → Extensions → buscar "postgis" → Enable. El SQL `CREATE EXTENSION` falla en cloud por permisos — usar solo el Dashboard.
2. Migrar: `ALTER TABLE leads ADD COLUMN gps geography(Point, 4326);`
3. Backfill: `UPDATE leads SET gps = ST_MakePoint(lng, lat)::geography WHERE lat IS NOT NULL AND lng IS NOT NULL;`
4. Índice: `CREATE INDEX leads_gps_gist ON leads USING GIST(gps);`
5. Agregar función `computeCompetitiveDensity(lead)` en scoring/index.ts — llama a query PostGIS y retorna tag `gap-cluster-high` o `gap-cluster-isolated`

**Verificación:** `SELECT COUNT(*) FROM leads WHERE gps IS NOT NULL;` debe ser > 3000.

---

## API HTTP y frontend

> El sistema usa un **repo único** con tres directorios: `src/` (core pipeline), `api/` (Fastify), `ui/` (Next.js).
> Dos procesos en el servidor: core pipeline + API HTTP.
> Ver `context/ARCHITECTURE_FUTURE.md § Arquitectura: un repo, dos procesos` para el diseño completo.

### Fase API-0 — Tabla `users` + roles (PREREQUISITO de la API)

**Por qué:** la API tiene múltiples usuarios con roles diferentes (admin, cm). El schema debe existir antes del primer endpoint. Ver `ARCHITECTURE_FUTURE.md § Autenticación y roles`.

**Implementación:**
1. Migración: tabla `users` (id, email, password_hash, role, lead_filter, active, created_at, updated_at, last_login_at) — ver schema completo en `ARCHITECTURE_FUTURE.md § Autenticación y roles`
2. Migración: `ALTER TABLE lead_outreach ADD COLUMN user_id uuid REFERENCES users(id) NOT NULL;`
   — si la tabla no existe todavía, `user_id` entra desde el CREATE inicial (Fase 25)
3. Insertar usuario admin inicial:
   ```sql
   INSERT INTO users (email, password_hash, role)
   VALUES ('admin@blindspot.local', '<bcrypt_hash_cost12>', 'admin');
   ```
4. Índice lookup: no crear índice adicional — `email text UNIQUE NOT NULL` ya crea el índice automáticamente.
5. Trigger `updated_at`:
   ```sql
   CREATE OR REPLACE FUNCTION set_updated_at()
   RETURNS TRIGGER LANGUAGE plpgsql AS $$
   BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
   CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
   ```

**`lead_filter` null/empty behavior:** si `lead_filter IS NULL` → admin (ve todo). Si `lead_filter = '{}'` → CM sin restricciones (igual que admin, úsese solo para testing). Si `lead_filter = '{"primary_offer":[]}'` → CM sin leads visibles (configuración de error, validar en API antes de guardar).

**Sin self-registration** — admin crea cuentas CM vía `POST /api/v1/users` o query directa.

---

### Fase API — Servidor Fastify en `api/` (mismo repo)

**Por qué:** el frontend necesita una API REST. La API vive en `api/` dentro de este repo — mismo servidor, mismo deploy, sin coordinación cross-repo. Core pipeline (Playwright, scoring, discovery) sigue siendo proceso separado.

**Prerequisitos:** Fase 22 estable + `contact_tier` + `pitch_hook` + `inferred_state` como columna + Fase API-0 (users).

**Estructura `api/`:**
```
api/
├── src/
│   ├── server.ts          ← Fastify instance + plugins
│   ├── auth/
│   │   ├── middleware.ts  ← JWT verify + role check
│   │   └── routes.ts      ← POST /auth/login, POST /auth/refresh
│   ├── routes/
│   │   ├── leads.ts       ← GET /leads, GET /leads/:id, PATCH /leads/:id/contact
│   │   ├── outreach.ts    ← GET/POST/PATCH /outreach, POST /outreach/generate-offer
│   │   ├── pipeline.ts    ← GET/PUT /pipeline/config, POST /pipeline/run, GET /pipeline/runs
│   │   ├── discovery.ts   ← GET/POST /discovery/jobs
│   │   ├── stats.ts       ← GET /stats/overview, /stats/outreach, /stats/pipeline
│   │   ├── users.ts       ← GET/POST/PATCH /users (solo admin)
│   │   └── health.ts      ← GET /health (público)
│   └── db/
│       └── client.ts      ← createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
└── package.json
```

**Lo que NUNCA va en `api/`:**
- Playwright, Puppeteer, o cualquier browser automation
- Lógica de scoring (`computeContactTier`, `calculateSubScores`, etc.)
- Discovery providers (`YeluProvider`, `OSMProvider`, etc.)
- Enrichment parsers

**Configuración Fastify (plugins obligatorios):**
```typescript
// server.ts
app.register(import('@fastify/cors'), {
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
})
app.register(import('@fastify/helmet'))  // headers de seguridad
app.register(import('@fastify/rate-limit'), { max: 100, timeWindow: '1 minute' })
```

**Vista `lead_dashboard`:** VIEW normal (no MATERIALIZED) — suficiente para 2-5 usuarios. Crear como paso explícito antes del primer endpoint de leads:
```sql
-- Ejecutar como migración al deployar la API
CREATE VIEW lead_dashboard AS
SELECT ... -- ver definición completa en ARCHITECTURE_FUTURE.md § View lead_dashboard
```

**Paginación cursor-based en todos los list endpoints:**
- Todos los GET de colecciones aceptan `limit` (default 50, max 200) y `cursor` (último `id` de la página anterior)
- Respuesta siempre incluye `{ data: T[], next_cursor: string | null, total: number }`
- Aplica a: `GET /leads`, `GET /outreach`, `GET /stats/outreach`, `GET /pipeline/runs`

**Validación de filtros de CM en endpoints individuales:**
- `GET /leads/:id` → si el lead no pasa el `lead_filter` del CM → 403 (no 404, para no revelar existencia)
- `PATCH /outreach/:id` → CM solo puede actualizar sus propios registros (`user_id = req.user.id`)
- `GET /stats/overview` → para CM, retorna solo sus métricas de outreach (no globales)

**Endpoint de password reset (admin only):**
- `PATCH /api/v1/users/:id` body: `{ password?: string, active?: boolean, lead_filter?: object }`
- Solo admin puede cambiar la password de otro usuario
- No hay "forgot password" email — uso interno, admin lo resetea directamente

**Trigger de pipeline:** `api/` escribe `pipeline_runs` row + `pg_notify('pipeline_trigger', run_id)`. Core escucha `LISTEN pipeline_trigger` + pollea `pipeline_runs WHERE status='pending'` cada 60s como fallback.

**Verificación post-setup:**
```bash
# API corriendo en puerto 3001:
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/v1/leads?contact_tier=A,B&prospect_score_gte=40&limit=5
# → { data: LeadCard[], next_cursor: string|null, total: number }

# Trigger de pipeline:
curl -X POST -H "Authorization: Bearer <token>" http://localhost:3001/api/v1/pipeline/run
# → { run_id: "uuid" }
# → core debe recibir el pg_notify y empezar a ejecutar
```

---

## Automatización de pipeline

### Fase 23 — Pipeline completo automatizado con cron + Pipeline Manager API

**Por qué:** hoy cada paso (refresh, discovery, enrich, score) se lanza manualmente. La automatización debe seguir el orden correcto: **primero refrescar lo existente, luego descubrir nuevo, luego enriquecer descubierto, luego re-scorear todo**. La configuración debe ser editable desde el frontend (Pipeline Manager) sin tocar el servidor. Ver `ARCHITECTURE_FUTURE.md § Pipeline de automatización completo`.

**Implementación — CLI (blindspot):**
1. Comando `blindspot pipeline --run-all [--cpu-budget balanced] [--dry-run] [--phases refresh,score]`
2. Tabla `pipeline_runs` — historial con `phase_results` detallados por fuente y `log_lines`
3. Tabla `pipeline_config` — configuración persistida en DB, editable desde UI
4. `node-cron` para schedule interno — se reconfigura en memoria cuando UI actualiza la config
5. Al terminar: verificar invariantes, guardar en `pipeline_runs.invariant_details`

**Implementación — API (para el Pipeline Manager del frontend):**
1. `GET/PUT/PATCH /api/pipeline/config` — leer y escribir pipeline_config
2. `POST /api/pipeline/run` — disparar ejecución con overrides opcionales → `{ run_id }`
3. `POST /api/pipeline/run/dry` → plan de qué haría sin ejecutar
4. `POST /api/pipeline/abort` — abortar run activo limpiamente
5. `GET /api/pipeline/runs/active` — run activo con progress en tiempo real
6. `GET /api/pipeline/runs/:id/log?since=<ts>` — nuevas líneas de log (polling cada 3s desde UI)

**Fases del pipeline en orden:**
```
1. Refresh stale enrichments (por source, prioridad tiers A+B primero)
2. Discovery queue (discovery_jobs pendientes)
3. Enrich nuevos descubiertos
4. Score de todos los actualizados + buyer types
5. Invariant check + report
```

**Parámetros configurables desde UI:**
- `cron_expression`: cuándo corre automáticamente
- `cpu_budget`: conservative/balanced/aggressive (determina concurrencia)
- `timeout_per_lead_sec`, `max_retries`: tolerancia a errores
- Por fase: habilitado/deshabilitado, fuentes incluidas, with_heuristic, max_jobs
- `enabled`: on/off del cron completo sin perder la config

**Archivos:** `src/cli/commands/pipeline.ts` (nuevo), `src/api/routes/pipeline.ts` (nuevo), `src/api/pipeline/scheduler.ts` (nuevo), tablas `pipeline_runs` + `pipeline_config`

---

### Fase 24 — Batch discovery multi-ciudad

**Por qué:** explorar 10 ciudades requiere 10 comandos. Con batch se hace en uno.

**Implementación:**
1. `discover-external --location-list "salto,paysandu,rivera,rocha"` — itera por ciudad
2. `discover-external --location-list-file config/locations.yaml` — desde archivo de config
3. Integración con `pipeline_runs` — cada ciudad es un sub-job con progreso propio

**Archivos:** `src/cli/commands/discover-external.ts`, nuevo `config/locations.yaml`

---

## Producto — UI y outreach

### Fase 25 — lead_outreach tracking (feedback loop base)

**Por qué:** sin registro de qué pasó con los leads contactados, el sistema no puede mejorar. Esta fase solo guarda datos — el algoritmo los usa en fases posteriores. Ver `ARCHITECTURE_FUTURE.md § Feedback loop de outreach`.

**Implementación:**
1. Migración: crear tabla `lead_outreach` (ver diseño completo en ARCHITECTURE_FUTURE.md)
2. UI modal en Lead Detail: "Registrar contacto" → canal + respondió + outcome + servicio + precio (todo opcional)
3. Vista "Mis contactos" en UI: lista de leads con outreach registrado, filtrables por status
4. CLI para ver stats básicos: `blindspot outreach --stats` (cuántos contactados, cuántos cerrados)

**Campos críticos a guardar:** channel, status, outcome, service_sold, price_sold, notes, lead_quality_signal.

**Lo que NO implementar en esta fase:** algoritmo de mejora de scoring desde feedback. Solo guardar.

---

### Fase 26 — Generación de ofertas con LLM (proveedor genérico)

**Por qué:** el agente de ventas no debe escribir el pitch desde cero. El sistema genera un draft basado en las señales del lead; el humano revisa y envía. Ver `ARCHITECTURE_FUTURE.md § Generación de ofertas con IA`.

**Implementación:**
1. Interface `LLMProvider` con implementaciones: `GeminiProvider`, `OllamaProvider`, `OpenAICompatibleProvider`
2. Config via `.env`: `LLM_PROVIDER=gemini|ollama|openai-compatible` + credenciales por proveedor
3. Función `generateOffer(lead, offerType, channel): Promise<OfferPackage>` con fallback a templates
4. UI en Lead Detail: botón "Generar oferta" → muestra texto generado → "Copiar" / "Editar" / "Aprobar"
5. Guardar oferta generada en `lead_outreach.offer_text` + `offer_source` (qué LLM la generó)

**Proveedor recomendado para empezar:** Gemini free tier (gemini-1.5-flash) — sin costo, 1M tokens/día, suficiente para ~2000 ofertas/día.

**Prerequisito:** Fase 25 (tabla lead_outreach donde persiste la oferta).

---

### Fase 27 — Service pricing table (cuantificación real de ROI)

**Por qué:** los pitches dicen "el sistema cuesta $X" pero ese número no existe. Cada usuario de Blindspot tiene sus propios precios. Sin tabla de precios, la cuantificación es un placeholder.

**Implementación:**
1. Tabla `service_pricing` editable en UI: tipo de servicio → precio base → precio recurrente
2. Ejemplos precargados: web desde cero, rediseño, community management, sistema de reservas, POS delivery
3. `commission_estimate` en buyer_type `delivery_propio` usa `service_pricing.delivery_system` para calcular ROI real
4. La generación de ofertas (Fase 26) consulta esta tabla para incluir números reales

---

## Enriquecimiento avanzado

### Fase 28 — Sub-niche detection para leads "other"

**Por qué:** 2.034 leads (59% del total passed) clasificados como "other". Rating promedio 4.57, 225 reviews, zero hot leads. Son ferreterías, veterinarias, estudios contables, ópticas, spas — negocios con presupuesto real completamente invisibles para el scoring. Ver `ARCHITECTURE_FUTURE.md § Sub-niche detection`.

**Implementación:**
1. Dos paths de detección:
   - Con RUT (MINTUR leads): CIIU del dataset DGI → sub-niche via tabla de mapeo
   - Sin RUT: llamada a LLMProvider con prompt de clasificación (Haiku/Gemini flash, ~5 tokens output)
2. Nuevo campo: `lead_company_data.detected_sub_niche`
3. Sub-niche activa lógica de sub-scores específica en `sub-scores.ts`
4. CLI: `blindspot enrich --sub-niche-detection --niche other`

**Costo estimado:** 2034 × ~50 tokens input = 102k tokens. Gemini free tier: gratis. Ollama local: ~68 minutos con Mistral 7B.

**Prerequisito:** Fase 26 (LLMProvider disponible).

---

### Fase 29 — MINTUR TipoOperador + RUT extraction

**Por qué:** MINTUR clasifica sus 2027 registros por tipo de operador (hotel, restaurante, agencia de viajes, spa, guía turístico). Esta info está en `source_data` JSONB sin parsear. Un hotel 3 estrellas sin web tiene un pitch y deal size completamente diferente a un camping sin web. También: extraer RUT de source_data y guardarlo en `lead_company_data.rut` para preparar Fase 30.

**Implementación:**
1. Parser `TipoOperador` en enrich de MINTUR: extraer de `source_data` → guardar en `lead_company_data.tipo_operador`
2. Mapeo `TipoOperador` → sub-niche → sub-scores específicos
3. Parser RUT: normalizar formato UY → guardar en `lead_company_data.rut`
4. Índice: `CREATE INDEX leads_tipo_operador ON leads ((lead_company_data->>'tipo_operador'));`

**Archivos:** `src/modules/enrichment/parsers/rut.ts` (nuevo), `src/modules/enrichment/index.ts`

---

### Fase 30 — DGI dataset resolution (RUT → CIIU → régimen fiscal)

**Por qué:** RUT → razón social + CIIU4 + régimen fiscal es el dato de mayor valor para estimar deal size. Un negocio en régimen general IRAE con facturación > $2M UYU/mes tiene presupuesto real para servicios digitales. Ver `ARCHITECTURE_FUTURE.md § DGI + RUT`.

**Estrategia por etapas:**
1. **Etapa A** (inmediata, costo 0): guardar RUT de MINTUR en `lead_company_data.rut` (parte de Fase 29)
2. **Etapa B** (mediano plazo): descargar dataset DGI de datos.gub.uy → script batch de resolución RUT → razón social + CIIU
3. **Etapa C** (largo plazo): régimen fiscal desde BPS o DGI API → `business_quality_pts` ajustado por tamaño

**Impact del régimen fiscal en scoring:**
- Monotributo (< $200k UYU/mes): `business_quality_pts` × 0.7
- IRAE pequeña empresa: × 1.3
- IRAE régimen general: × 1.5

**Prerequisito:** Fase 29 (RUT en lead_company_data).

---

### Fase E — Fix discover-external + Reconocimiento de franquicias ✅ Completada

**Diagnóstico ejecutado:** los tags `possible-duplicate` en MINTUR NO venían de Levenshtein
sino de `tagDuplicates` (identity-keys: phone, address). Los duplicados son reales —
MINTUR registra el mismo negocio bajo múltiples categorías de operador (ABITAB: 182 entradas,
HERTZ: 10 entradas). No hay falsos positivos por nombre.

**Bug corregido:** `discover-external.ts` ahora actualiza `allLeads` en memoria después de cada
inserción — candidatos del mismo run ya detectan leads recién insertados.

**Franquicias implementadas:** `isFranchise()` + `tagFranchises()` + tag `franchise-detected`.
Ver ARCHITECTURE.md para detalles.

---

### Fase B — Sub-scores por tipo de oferta ✅ Completada

Ver ARCHITECTURE.md — sección Scoring para detalles de implementación.

---

### Fase F — Capa de inferencia de estado operativo ✅ Completada

`computeInferredState` en `src/modules/enrichment/inferred-state.ts`. Corre al final del pipeline enrichment. 20 tests nuevos. Ver ARCHITECTURE.md para detalles de la interfaz y reglas de inferencia.

**Reglas de inferencia:**

| Conclusión | Señal | Confianza |
|---|---|---|
| `has_reservations` | `booking_platforms` o `reservation_platforms` no vacío | 0.9 |
| `has_reservations` | `contact_form` + niche gym/hairdresser | 0.5 |
| `has_delivery` | `delivery_platforms` no vacío | 0.8 |
| `has_delivery` | `source === 'pedidosya'` o `corroborating_sources` incluye pedidosya | 0.95 (✅ activo) |
| `has_online_catalog` | `ecommerce_platforms` detectado (Fase D) | 0.9 |
| `has_online_catalog` | `menu_links` (PDF) detectado | 0.85 |
| `has_online_catalog` | `menu_keywords` + es restaurant | 0.6 |
| `has_ecommerce` | `ecommerce_platforms` (Shopify, WooCommerce, Tienda Nube, MercadoShops) | 0.95 |
| `has_pos` | `has_ecommerce` + `has_delivery` juntos | 0.7 |
| `has_pos` | Pasarela de pago detectada (MercadoPago, Stripe, PayPal) | 0.8 |
| `has_chat_support` | `chat_widget` en DOM hidratado (Playwright) | 0.9 |
| `has_chat_support` | `whatsapp-confirmed` | 0.85 |

**Impacto en scoring (Fase B):**
- Negocio con `has_delivery + has_reservations + has_ecommerce` → `digitalization_level: advanced` → sub-scores de software y catálogo bajan, pero sube potencial de oferta de "siguiente nivel" (CRM, analytics, integración).
- Negocio con `has_delivery` pero sin web propia → `score_web_nuevo` alto + pitch "independizate de la comisión".

**Fuentes futuras que alimentan inferencias:**
- PedidosYa (Fase 10): confirma `has_delivery` con alta confianza
- Yelu (Fase 9): confirma `has_online_catalog` si tiene descripción de servicios
- IMM Habilitaciones (Fase 11): confirma `has_formal_registration`

---

### Fase C — Cadencia de refresh por source ✅ Completada

`source_refresh` en `config/discovery.yaml` (google_places:30, mintur:90, osm:90). `maintenance` ahora detecta y re-enriquece fuentes externas stale via `enrichCommand --source`. `getSourceRefreshDays()` en modules/discovery/config.ts.

---

## Arquitectura multi-source — Nuevos providers

> Las fases con fuente externa tienen su investigación en `context/research/<fuente>.md`.
> Antes de implementar una fase sin MD → correr Gemini DeepSearch primero (ver flujo en PROJECT_MASTER.md).
> PedidosYa (Fase 10) es especialmente importante: confirma `has_delivery` en `inferred_state` con alta confianza.

### Fase 6 — ✅ Movida al bloque Urgente (ver arriba)

---

| Fase | Descripción | Investigación | Prioridad |
|------|-------------|---------------|-----------|
| 9 | YeluProvider — scraping yelu.uy (31k listings, confianza 0.65) | ✅ Completada | — |
| 10 | PedidosYaProvider — confirma delivery activo. Alimenta `inferred_state.has_delivery` con confianza 0.95 | ✅ Completada | — |
| 11 | IMM Habilitaciones provider — CSV Montevideo, negocios habilitados activos | pendiente | **Media** — desbloquea teléfonos para MINTUR (Fase 18) |
| 12 | InfoNegocios provider — decisores B2B, emails de gerencia | pendiente | Baja |
| 13 | DGI dataset — RUT → razón social + CIIU + régimen fiscal. Ver Fase 30. Estrategia: traer datos primero, procesar después | pendiente (Fase 30) | **Alta en valor, media en urgencia** |
| 18 | Cruce MINTUR × IMM — join por nombre+dirección para resolver teléfonos faltantes en 1600 leads MINTUR | depende de Fase 11 | Media — desbloquea el 96% de MINTUR hoy inaccionable |

---

## Mejoras de scoring y segmentación

---

### Fase 12 — Buyer-type scoring ✅ Completada

Ver ARCHITECTURE.md — tabla `lead_buyer_scores`, 7 buyer types, CLI `score --buyer-types`. 850 tests pasando.

---

### Fase 13 — PedidosYa escape: segmento de alto valor (desbloqueada por Fase 12)

**Por qué:** un negocio en PedidosYa paga ~30% de comisión por pedido. El pitch no es "construite una web" sino "independizate con tu propio sistema de pedidos a $X/mes". Es la propuesta comercial más concreta y cuantificable que genera el sistema.

**Señales del segmento:**
- `inferred_state.has_delivery.value = true` Y `inferred_state.has_delivery.confidence >= 0.90`
- Y `inferred_state.has_pos.value = false` (o sin señal de sistema propio)
- Fuente confirmatoria: `corroborating_sources` incluye `pedidosya` OR `source = 'pedidosya'`

**Implementación:**
- `delivery_propio` buyer_type (definido en Fase 12) es el score de este segmento
- Agregar campo `commission_estimate` en `breakdown` del buyer_type: `{ monthly_orders_est: 'N/A', commission_rate: 0.30, pitch_hook: 'independizate-de-pedidosya' }`
- Query de extracción: `SELECT l.*, lbs.score FROM leads l JOIN lead_buyer_scores lbs ON lbs.lead_id = l.id AND lbs.buyer_type = 'delivery_propio' WHERE lbs.score >= 60 ORDER BY lbs.score DESC`

**Depende de:** Fase 12 (buyer_type `delivery_propio`), PedidosYa discovery activo.

---

### Fase 15 — Clasificación de calidad de email + tipo de teléfono (PRIORIDAD ALTA — ejecutar después de Fase 6)

> Ver `PROJECT_MASTER.MD § Próximas acciones` — esta fase está en el camino crítico antes de UI.

**Por qué (email):** hoy detectamos emails pero no diferenciamos `info@dominio.com` (genérico, responde el que atiende) de `juan@dominio.com` (personal, decide el dueño). El email del dueño vale 3× para prospecting.

**Por qué (teléfono):** en Uruguay `09x` es móvil — llega directo al dueño. `02x` es fijo Montevideo (recepción). `04x` son fijos del interior. El pitch por llamada tiene probabilidad de éxito completamente distinta según tipo.

**Clasificación de email:**

| Tipo | Patrón | `contact_reliability` |
|---|---|---|
| `generic` | `info@`, `contacto@`, `admin@`, `ventas@`, `hola@` | ×0.5 |
| `role` | `gerencia@`, `dueño@`, `propietario@` | ×1.2 |
| `personal` | Nombre propio detectado (`juan.garcia@`) | ×1.5 |
| `domain_match` | Dominio coincide con nombre del negocio | ×1.1 |

**Validación MX:**
- Check de MX record del dominio del email (`dns.resolve('dominio.com', 'MX')`)
- Si no hay MX válido → tag `email-no-mx`, reducir `contact_reliability` en 0.2
- Solo para emails en footprint, no para emails de fuentes externas

**Clasificación de teléfono:**
- Regex: `09\d{7}` → celular → tag `mobile-phone`, `contact_reliability += 0.15`
- Regex: `0[2-4]\d{7,8}` → fijo → tag `landline-phone`
- Aplica a todos los teléfonos en `canonical_fields.phone.value` y `digital_footprint.contact_phones`

**Archivos:** nuevo `src/modules/enrichment/parsers/email-quality.ts`, nuevo `src/shared/phone.ts`, ajuste en `src/modules/enrichment/index.ts`.

---

### Fase 17 — Investigación perfil MINTUR (diagnóstico antes de implementar)

**Síntoma:** 2027 leads de MINTUR enriquecidos, 0 hot (prospect_score >= 50). Antes de ajustar scoring, diagnosticar.

**Queries de diagnóstico a correr:**

```sql
-- Distribución de scores MINTUR
SELECT
  width_bucket(prospect_score, 0, 100, 10) * 10 AS score_bucket,
  COUNT(*) AS leads
FROM leads WHERE source = 'mintur' AND prospect_score IS NOT NULL
GROUP BY 1 ORDER BY 1;

-- Sub-scores promedio MINTUR vs google_places
SELECT source,
  AVG((score_breakdown->'sub_scores'->>'web_nuevo')::numeric) AS avg_web_nuevo,
  AVG((score_breakdown->'sub_scores'->>'marketing')::numeric) AS avg_marketing,
  AVG((score_breakdown->'sub_scores'->>'software')::numeric) AS avg_software
FROM leads WHERE source IN ('mintur','google_places') AND score_breakdown IS NOT NULL
GROUP BY source;

-- Cuántos MINTUR tienen website en footprint
SELECT
  COUNT(*) FILTER (WHERE digital_footprint->>'website' IS NOT NULL) AS con_web,
  COUNT(*) FILTER (WHERE digital_footprint->>'website' IS NULL) AS sin_web
FROM leads WHERE source = 'mintur';
```

**Diagnóstico ejecutado (2026-05-15). Causa raíz confirmada.**

| Métrica | Valor |
|---|---|
| Con web directa | 0 / 2027 |
| Web vía heuristic | 384 |
| Con email | 90 (4.4%) |
| Con phone | **0 (0%)** |
| Franchises | 218 |
| `web_nuevo` avg | **0.0** — colapsado por contactabilidad |

**Causa:** `contactability_multiplier ≈ 0` sin teléfono. El scoring es correcto — un lead incontactable no tiene valor comercial. MINTUR es fuente de *descubrimiento* pero no de *contacto*.

**Subsegmento accionable hoy:** ~80 leads (`email-found` AND NOT `franchise-detected`). Se rankean correctamente con Fase 12 buyer_type scores.

**Plan:**
1. **Corto plazo:** usar solo los 80 con email. Fase 12 los rankeará correctamente.
2. **Mediano plazo (Fase 18):** cruzar MINTUR con IMM Habilitaciones → teléfono habilitación municipal desbloquea ~1600 leads. Ver tabla providers.
3. **No hacer:** inflar scoring artificialmente para leads sin contacto.

---

### Items de mejora de scoring (backlog)

| Item | Descripción | Prioridad |
|------|-------------|-----------|
| Corroboración cross-source v2 | Si mismo email aparece en 2+ fuentes → `contact_reliability +0.2`. Si phone diferente en 2+ fuentes → tag `phone-conflict` + penalty | Media |
| Zona turística urgency | Implementar como parte de Fase 16 (señales urgencia) | Media |
| Competitor density signal | Si 3 negocios del mismo niche/zona sin web → pitch más débil (todos sobreviven sin ella). Requiere query geoespacial. | Baja |

---

## Reconocimiento de franquicias

Sistema implementado en Fase E. Pendiente:

| Item | Descripción | Prioridad |
|------|-------------|-----------|
| Filtro en CLI y reportes | `--exclude-franchises` en discover y report. La UI futura lo hereda | Media |

---

## Discovery pendiente

Ejecutar solo después de confirmar invariantes en 0.

| Acción | Perfil | Prioridad |
|--------|--------|-----------|
| Colonia del Sacramento — restaurant + hospedaje | A/B | ✅ Ejecutado (2026-05-15). 0 leads nuevos — mercado turístico, todos con web y reviews altas. No re-intentar. |
| Minas (Lavalleja) — restaurant + gym | A/B | ✅ Ejecutado (2026-05-15). 0 leads nuevos — ya estaban en DB. |
| Durazno — restaurant + car_dealer | A/B | ✅ Ejecutado (2026-05-15). 3 leads nuevos (score 63/45/15). |
| Barra de Valizas / Rocha — restaurant | A | Media |
| Salto — restaurant (La Vieja Cocina mostró potencial) | A/B | Media |
| Yelu — más ciudades (Salto, Maldonado, Colonia) — restaurant + hairdresser | — | Media — Yelu Montevideo aportó 1113 candidatos (338 restaurant + 387 hairdresser + 388 car_dealer). Gym = 0 resultados. |
| OSM — más niches para ciudades existentes (hairdresser, car_dealer) | — | Media — OSM Montevideo gym = 0 resultados (tag leisure=gym escaso en UY). Probar shop=hairdresser. |
| PedidosYa — montevideo restaurant | — | Pendiente post-Fase 11 (stealth activo). Correr `discover-external --source pedidosya --location montevideo --niche restaurant --limit 200` |

---

## Pre-producción — antes de dar acceso a otros usuarios

> Estos items deben estar resueltos antes de compartir la URL con cualquier CM.

| Item | Por qué | Cómo |
|------|---------|------|
| **HTTPS + reverse proxy Nginx** | Sin HTTPS, JWT viaja en claro | Nginx + Let's Encrypt (certbot) |
| **Anti-detección scraping** | Yelu y PedidosYa pueden banear la IP con runs semanales desde la misma IP | User-agent rotation + delays aleatorios (200-800ms) + config en `config/discovery.yaml → scraping` |
| **DB backup automatizado** | Un solo servidor, pérdida = pérdida total de leads | `pg_dump` en cron diario → comprimido → carpeta local + sync a Backblaze B2 o similar |
| **Rate limiting en API** | Evitar hammering accidental | Fastify `@fastify/rate-limit`: 100 req/min por token, 10 req/min en `/auth/login` |
| **pm2 para gestión de procesos** | Reinicio automático si core o api crashean | `pm2 start` para ambos procesos + `pm2 startup` |

---

## Infraestructura y operaciones

### Fase 31 — DIFERIDA (no aplica al modelo de un repo)

~~Preparar `blindspot` (core) para modo long-running~~ — el core ya corre como proceso separado (`pnpm --filter core run start`) con `LISTEN pipeline_trigger` + poll fallback. No requiere una fase adicional.

### Fase 32 — DIFERIDA (VIEW normal es suficiente para 2-5 usuarios)

~~MATERIALIZED VIEW~~ — `lead_dashboard` como VIEW normal con índices correctos maneja sin problema la carga de 2-5 usuarios. Revisar si y cuando aparezca latencia real.

### Fase 33 — DIFERIDA (sin consumidores externos)

~~API versionado~~ — un solo equipo, un solo repo, sin consumidores externos de la API. No hay breaking changes que coordinar con terceros.

### Fase 35 — SIMPLIFICADA

~~Detección de cron missed runs~~ — pm2 reinicia el proceso si cae. El poll de `pipeline_runs WHERE status='pending'` cada 60s recupera runs que llegaron mientras el proceso estaba reiniciando. Suficiente para uso personal.

---

### Fase 34 — Endpoint `/api/v1/health`

**Por qué:** sin un health endpoint no hay forma de monitorear el servidor sin abrir la UI. Crítico antes de dar acceso a CMs.

**Implementación en `api/src/routes/health.ts`:**
```typescript
// GET /api/v1/health — sin autenticación (público para monitors externos)
// → { status, db: 'ok'|'error', pipeline_running, leads_count, hot_leads_count, version }
```

**Verificación:** `curl http://localhost:3001/api/v1/health` → JSON con `status: 'ok'`.

---

### Fase 32 — `lead_dashboard` como MATERIALIZED VIEW + refresh automático

**Por qué:** hoy es una VIEW normal que recalcula en cada query con LEFT JOIN. Con múltiples usuarios en la UI y actualizaciones frecuentes, la latencia va a ser impredecible. Ver `ARCHITECTURE_FUTURE.md § lead_dashboard MATERIALIZED VIEW`.

**Implementación:**
1. `DROP VIEW lead_dashboard; CREATE MATERIALIZED VIEW lead_dashboard AS ...`
2. Índices: `contact_tier`, `prospect_score DESC`, `primary_offer`, `urgency_signal`, `contacted_at`
3. `REFRESH MATERIALIZED VIEW CONCURRENTLY lead_dashboard` como último paso del pipeline run
4. Campo `pipeline_runs.dashboard_stale: boolean` para forzar refresh en próximo ciclo si el run falla a medio camino

**Verificación:** `EXPLAIN ANALYZE SELECT * FROM lead_dashboard WHERE contact_tier='A' LIMIT 50` debe mostrar Index Scan, no Seq Scan.

---

### Fase 33 — API versionada `/api/v1/`

**Por qué:** sin versionado, cualquier breaking change en el contrato rompe el frontend cuando los dos repos evolucionan independientemente. Ver `ARCHITECTURE_FUTURE.md § Versionado de API`.

**Implementación:**
1. Todos los routes pasan de `/api/` a `/api/v1/`
2. Redirección 301: `/api/*` → `/api/v1/*` para compatibilidad durante la transición
3. Headers de respuesta: `X-API-Version: 1`, `X-Scoring-Version: <n>`
4. Actualizar `config/api.yaml` con `api_version: 1`

**Prerequisito:** antes de que el frontend empiece a consumir la API.

---

### Fase 34 — Endpoint `/api/v1/health` + observabilidad básica

**Por qué:** sin un health endpoint, no hay forma de monitorear el servidor sin abrir la UI completa. Crítico para producción. Ver `ARCHITECTURE_FUTURE.md § Endpoint /api/v1/health`.

**Implementación:**
1. `GET /api/v1/health` → `{ status, db, cron: { status, last_run_at, next_run_at, missed }, pipeline_running, leads_count, hot_leads_count, version }`
2. Sin autenticación — público para monitors externos
3. Función `checkMissedRun()` en `src/api/pipeline/scheduler.ts` ejecutada en `onReady` hook de Fastify

**Archivos:** `src/api/routes/health.ts` (nuevo)

---

### Fase 35 — Detección de cron missed runs (startup recovery)

**Por qué:** si el servidor se reinicia cuando debía correr el cron semanal, el run se pierde silenciosamente. Ver `ARCHITECTURE_FUTURE.md § Detección de cron missed runs`.

**Implementación:**
1. Columna `scheduled_for timestamptz` en `pipeline_config` — próxima ejecución esperada
2. Al guardar config (`PUT /api/v1/pipeline/config`) → recalcular y guardar `scheduled_for`
3. `checkMissedRun()` en startup: si `scheduled_for < NOW() - 15min` Y `last_completed_at < scheduled_for` → disparar recovery run automático

**Prerequisito:** Fase 34 (health endpoint expone `cron.missed: boolean`).

---

## Mejoras de scoring y segmentación (continuación)

### Fase 36 — `days_in_pool` en timing_factor de scoring v2

**Por qué:** leads recién descubiertos tienen ventaja competitiva — nadie los ha contactado. La fórmula v2 no captura esta señal. Ver `ARCHITECTURE_FUTURE.md § days_in_pool`.

**Implementación:**
1. Agregar `days_in_pool` config block en `config/scoring.yaml → commercial_score.timing`
2. Calcular en `computeTimingFactor(lead)`: fresh < 7d → +0.05, stale > 90d → -0.05
3. Persistir `score_breakdown.days_in_pool: number` para la UI

**Prerequisito:** Fase 22 (Scoring v2 completo).

---

### Fase 37 — `canonical_source` — fuente de mayor confianza del lead

**Por qué:** el campo `source` refleja la fuente de descubrimiento, no la más confiable. Un lead corroborado por Google Places debería mostrar GP como fuente canónica aunque haya sido descubierto en OSM. Ver `ARCHITECTURE_FUTURE.md § canonical_source`.

**Implementación:**
1. `ALTER TABLE leads ADD COLUMN canonical_source text`
2. Calcular al reconciliar `canonical_fields`: fuente con mayor `source_confidence` entre primaria y corroborantes
3. Actualizar `lead_dashboard` VIEW/MV para exponer `canonical_source`
4. Backfill: `UPDATE leads SET canonical_source = source WHERE canonical_source IS NULL`

---

### Fase 38 — Deduplicación con coordenadas geográficas

**Por qué:** `findCrossSourceMatch` usa solo similitud de nombre. Dos negocios con el mismo nombre en ciudades distintas se matchearían erróneamente al escalar a más ciudades. Ver `ARCHITECTURE_FUTURE.md § Deduplicación con coordenadas geográficas`.

**Implementación:**
1. Función `haversineDistance(a, b): number` en `src/modules/discovery/deduplication.ts` — distancia en metros
2. `findCrossSourceMatch` v2: filtrar por niche exacto + radio Haversine < 500m (si ambos tienen GPS) antes del threshold de nombre
3. Config en `config/discovery.yaml`: `deduplication.geo_radius_meters: 500`
4. Tests para: mismo nombre ciudades distintas (no debe matchear), mismo nombre ±200m (sí debe matchear)

**Prerequisito:** Fase 6 (cross-source dedup activo).

---

## Producto avanzado (post-UI)

> Estas fases agregan valor diferencial pero requieren que la UI base esté operativa.

### Fase 39 — Webhook de notificaciones externas

**Por qué:** el equipo de ventas necesita ser notificado cuando el pipeline genera nuevos hot leads sin tener la UI abierta. Ver `ARCHITECTURE_FUTURE.md § Webhook de notificaciones externas`.

**Implementación:**
1. Campos en `pipeline_config`: `notify_webhook_url`, `notify_webhook_secret`, `notify_webhook_events[]`
2. `src/api/pipeline/notifications.ts` → `notifyWebhook(run: PipelineRun): Promise<void>`
3. Payload: `{ event, run_id, new_hot_leads, leads_enriched, invariants_ok, summary_url }`
4. HMAC-SHA256 en header `X-Blindspot-Signature` para verificación del receptor
5. Resultado en `pipeline_runs.webhook_status`: 'sent' | 'failed' | 'not_configured'
6. UI: campo en Pipeline Manager para configurar URL + botón "Probar webhook"

---

### Fase 40 — Full-text search de leads

**Por qué:** 2034 leads "other" con sub-niches no mapeados (veterinarias, farmacias, ópticas) son completamente invisibles sin búsqueda de texto. Ver `ARCHITECTURE_FUTURE.md § Full-text search`.

**Implementación:**
1. `ALTER TABLE leads ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (...) STORED`
2. Backfill: `UPDATE leads SET search_vector = ...` (trigger se encarga del futuro)
3. `CREATE INDEX leads_fts ON leads USING gin(search_vector)`
4. Endpoint: `GET /api/v1/leads?q=veterinaria` → `WHERE search_vector @@ plainto_tsquery('spanish', $q)`
5. UI: barra de búsqueda en Lead Explorer (actualmente falta)

**Verificación:**
```bash
curl /api/v1/leads?q=veterinaria&contact_tier=A,B
# → debe retornar leads con "veterinaria" en nombre o dirección
```

---

### Fase 41 — Detección de mismo propietario (`owner_group_id`)

**Por qué:** muchos dueños de PyMEs en Uruguay tienen 2–3 negocios. Contactarlos por separado es redundante. Ver `ARCHITECTURE_FUTURE.md § Detección de mismo propietario`.

**Implementación:**
1. `ALTER TABLE leads ADD COLUMN owner_group_id uuid`
2. `CREATE INDEX leads_owner_group ON leads(owner_group_id) WHERE owner_group_id IS NOT NULL`
3. Proceso de detección: post-enrich, buscar leads con mismo phone o email canónico → asignar mismo `owner_group_id`
4. API: `GET /api/v1/leads/:id/owner-group` → leads del mismo propietario
5. UI: badge "N negocios del mismo propietario" en Lead Detail y Lead Explorer

---

### Fase 42 — Scoring estacional

**Por qué:** el mismo lead vale más en ciertos momentos del año. Un gimnasio vale más como prospecto en enero. Ver `ARCHITECTURE_FUTURE.md § Scoring estacional`.

**Implementación:**
1. `seasonal_modifiers` config block en `config/scoring.yaml`
2. Función `computeSeasonalNote(lead, config): string | null` en `src/modules/scoring/index.ts`
3. Persistir `score_breakdown.seasonal_note` si aplica el mes actual
4. UI: el sort secundario de Lead Explorer usa `seasonal_note` para subir leads relevantes

**Prerequisito:** Fase 22 (Scoring v2 completo).

---

### Fase 43 — Campañas de outreach

**Por qué:** sin una entidad "campaña", no hay forma de medir qué segmentos convierten. Ver `ARCHITECTURE_FUTURE.md § Campañas de outreach`.

**Implementación:**
1. Tabla `outreach_campaigns(id, name, segment_filter jsonb, status, created_at, closed_at, notes)`
2. `ALTER TABLE lead_outreach ADD COLUMN campaign_id uuid REFERENCES outreach_campaigns(id)`
3. API CRUD: `GET/POST /api/v1/campaigns`, `GET /api/v1/campaigns/:id/stats`
4. UI: Outreach Tracker agrega selector de campaña activa + stats de conversión por campaña

**Prerequisito:** Fase 25 (lead_outreach tracking completo).

---

### Fase 44 — Presupuesto Google Places en UI

**Por qué:** el saldo de la API de Google existe solo en SECURITY.md como texto. La UI debe mostrar el consumo en tiempo real y alertar antes de agotar el crédito. Ver `ARCHITECTURE_FUTURE.md § Presupuesto Google Places`.

**Implementación:**
1. Campos en `pipeline_config`: `google_places_budget_total`, `google_places_budget_spent`, `google_places_alert_threshold`
2. Worker: `google_places_budget_spent += 0.02 × requests_made` al finalizar cada run con GP
3. UI: barra de presupuesto en Pipeline Manager → Estado del servidor
4. Alerta: badge rojo si `budget_remaining < alert_threshold`; incluir en payload de webhook

---

### Fase 45 — Change detection en re-enrich

**Por qué:** el sistema re-enriquece leads stale pero no detecta cambios. Un negocio que lanzó una web nueva debería moverse de `web_nuevo` a `rediseno` automáticamente. Ver `ARCHITECTURE_FUTURE.md § Change detection en re-enrich`.

**Implementación:**
1. Función `diffFootprint(prev, next): EnrichmentDiff` en `src/modules/enrichment/index.ts`
2. Si diff tiene cambios críticos (website appeared, contact_tier cambió) → tag `state-changed-significant` + re-score automático
3. Persistir `digital_footprint.last_change_diff: EnrichmentDiff`
4. Monitor de ejecución muestra "N leads con cambios significativos" post-run

---

## Deuda técnica

| Item | Descripción | Impacto |
|------|-------------|---------|
| `enrichment/index.ts` grande | Refactor en módulos más pequeños | Bajo |
| `patchLeadInferredState` no reutiliza `mergeFootprint` | UPDATE directo — puede haber conflictos si se escribe footprint parcial mientras otro proceso escribe. Revisitar si aparecen problemas de concurrencia. | Bajo |
| `whois.ts` sin tests | Hace I/O de red, falla silenciosa si formato cambia | Bajo |
| Fallbacks hardcodeados restantes | Post Fase D completa — revisar qué quedó | Medio |
| Phone regex unificada `shared/phone.ts` | Lógica de validación de teléfonos dispersa en varios parsers | Medio |
| `web-outdated` undercounting | copyright-year parser falla en sitios sin copyright visible. `outdated_year_threshold` movido a `config/enrichment.yaml` (valor: 2022) en Fase D | Bajo |
| Bounding boxes OSM en código | Coordenadas de 8 ciudades hardcodeadas en `providers/osm.ts`. Mover a `config/discovery.yaml` cuando se expanda a más ciudades | Bajo |
| Magic numbers de scoring en código | `0.85` dedup threshold, `1.2` contactability multiplier, `0.7` confirmation threshold — mover a `config/scoring.yaml` como parámetros nombrados. Los pesos de sub-scores en `sub-scores.ts` (35, 10, 15, 28, 25, 20...) también deberían moverse a config cuando se afinen. | Bajo |
| OSM enrich lento con --with-heuristic | ~3 leads/min para OSM (sin website/phone, heuristic hace muchos HTTP rounds). Considerar --with-heuristic opcional o concurrency=10 para fuentes sin URL directa. | Medio |
| `external_source_quality=70` calibración | OSM leads con bq=70 + buena heurística alcanzan score 75 sin calidad verificada. Considerar diferenciar: osm=55, mintur=70, yelu=60 según confiabilidad real de la fuente. | Medio |
| **Schema: `inferred_state` dentro de `digital_footprint`** | Actualmente es `digital_footprint->'inferred_state'` (JSONB anidado). Difícil de indexar y consultar. Mover a columna propia `inferred_state jsonb` en `leads`. Requiere migración + actualizar todos los accesos. La UI filtrará por `digitalization_level`, `has_delivery`, `has_pos` — sin columna propia es ineficiente. Ver `ARCHITECTURE_FUTURE.md § inferred_state como columna propia`. | **Alto — desbloquea UI** |
| **`contact_ready` field** | Derivar `contact_ready: boolean` en scoring y persistir en leads. Criterio: `contact_tier IN (A,B,C) AND prospect_score >= 30 AND NOT franchise-detected`. Reemplaza el uso de `passed_filter` como proxy de "accionable" para reportes de ventas. Ver `ARCHITECTURE_FUTURE.md § passed_filter semántico`. | Medio |
| **Schema: score columns dispersas en `leads`** | `business_quality_score`, `digital_gap_score`, `systems_gap_score`, `data_confidence_score`, `contact_reliability_score` son scores internos del pipeline en columnas sueltas. Candidatos a consolidar en `lead_buyer_scores` como tipos internos (`pipeline_bq`, `pipeline_dg`) cuando se implemente Fase 12. Evaluar junto con Fase 12. | Bajo |
| **Schema: tags como `text[]` sin confidence** | El array `tags` no puede expresar confianza por tag ni historial. Si el sistema crece en complejidad de tags, considerar `lead_tags(lead_id, tag, confidence, source, tagged_at)`. No urgente mientras tags sean booleanos. | Bajo |
| **`scoring_version` faltante** | `lead_buyer_scores` y `leads` no tienen campo `scoring_version`. Al cambiar la fórmula (v1→v2), no hay forma de identificar scores calculados con versión antigua. Agregar antes de desplegar Scoring v2. Ver `ARCHITECTURE_FUTURE.md § scoring_version`. | **Alto — prerrequisito de v2** |
| **Scraping sin anti-detección** | Yelu y PedidosYa no tienen rate limit propio, rotación de user agents ni backoff exponencial. Riesgo de ban en producción con runs semanales desde la misma IP. Mover config a `config/discovery.yaml → scraping`. Ver `ARCHITECTURE_FUTURE.md § Estrategia anti-detección`. | **Alto para producción** |
| **Cursor pagination inconsistente en la API** | `GET /api/leads` usa cursor-based. `GET /api/outreach` y `GET /api/pipeline/runs` no especifican mecanismo. Definir antes de que el frontend los consuma. | Medio |
| **Missed run detection no implementada** | El cron `node-cron` no persiste estado. Si el servidor se reinicia antes de un run programado, el run se pierde. Ver Fase 35 y `ARCHITECTURE_FUTURE.md § Detección de cron missed runs`. | **Alto para producción** |

---

## Proyecto frontend — `ui/` (directorio en este repo)

El frontend es un workspace Next.js en `ui/` dentro de este mismo repo.
Todo el diseño de pantallas, componentes y UX está en `context/ARCHITECTURE_FRONTEND.md`.

**Prerequisitos para iniciar `ui/`:**
- Fase API completada (API en `api/` corriendo en puerto 3001)
- Scoring v2 estable (`contact_tier` + `pitch_hook` en score_breakdown)
- Vista `lead_dashboard` creada en DB
- Tabla `users` + JWT funcionando

**Orden de construcción** (ver detalle en ARCHITECTURE_FRONTEND.md):
1. Lead Explorer básico (lista con filtros)
2. Lead Detail completo
3. Modal de registro de outreach
4. Generación de ofertas IA
5. Segment Explorer
6. Discovery Control Center

**No construir hasta que:** Fase API esté completa y se pueda hacer `curl /api/leads` y recibir datos reales.
