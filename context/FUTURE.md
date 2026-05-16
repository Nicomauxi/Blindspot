# Blindspot — Future

> Solo contiene lo que NO está hecho todavía.
> Al completar un item → borrarlo.
> Al agregar un objetivo nuevo → insertarlo en el lugar correcto por prioridad.

---

## Urgente — Bloqueantes para el valor del producto

> Ejecutar en este orden antes de agregar providers nuevos.
> Ver `ARCHITECTURE_FUTURE.md` para el diseño objetivo completo de scoring, contactabilidad y pitch.

### Fase 19 — Fix scoring formula para fuentes externas (CRÍTICO)

**Por qué:** `external_source_quality=70` suma puntos a `business_quality_score` (sistema viejo). La fórmula actual usa `max(sub_scores)` — los 70 puntos no tienen efecto en el score final. MINTUR, OSM y Yelu tienen scores de 1–18 aunque el sistema "debería" compensarlos. Ver `ARCHITECTURE_FUTURE.md § Fórmula corregida`.

**Implementación:**
1. Agregar `source_quality_bonus(lead): number` en `scoring/index.ts`:
   - mintur → +20, pedidosya → +15, yelu → +10, osm → +8, google_places → 0
   - Configurar en `config/scoring.yaml` bajo clave `source_quality_bonus`
2. Cambiar fórmula: `floor((max(sub_scores) + source_quality_bonus) × contactabilityMultiplier × reviewMultiplier) + ratingBonus`
3. Cambiar `contactabilityMultiplier`: actualmente `if(email) ×1.2 else ×1.0`.
   Nuevo: `email → ×1.3 | whatsapp → ×1.2 | email+whatsapp → ×1.4 | phone_only → ×1.0 | sin_nada → ×0.5`
4. Agregar sub-score `contacto_directo` en `scoring/sub-scores.ts` con cap 40:
   señales: tiene phone verificado + niche activo + sin plataforma digital conocida
5. Correr `score --all` para refrescar todos los leads

**Archivos:** `src/modules/scoring/index.ts`, `src/modules/scoring/sub-scores.ts`, `config/scoring.yaml`

**Verificación post-cambio:**
```sql
-- MINTUR debe tener leads con prospect_score > 30 post-fix
SELECT width_bucket(prospect_score, 0, 100, 5) * 20 AS bucket, COUNT(*)
FROM leads WHERE source = 'mintur' GROUP BY 1 ORDER BY 1;
```

---

### Fase 20 — `contact_tier` y `pitch_hook` en score_breakdown

**Por qué:** sin estos dos campos el sistema no puede responder las preguntas más básicas de ventas: ¿cómo contacto este lead? ¿qué le digo?. Ver `ARCHITECTURE_FUTURE.md § Pitch generation` y `§ Tiers de contacto`.

**Implementación:**
1. Función `computeContactTier(lead): 'A'|'B'|'C'|'D'|'X'` en `scoring/index.ts`
   - A: email verificado | B: whatsapp | C: phone | D: address | X: nada
2. Función `computePitchHook(primary_offer, inferred_state, niche): string` en nuevo archivo `scoring/pitch.ts`
   - Mapa configurable en `config/scoring.yaml` bajo `pitch_hooks`
3. Persistir ambos en `score_breakdown.contact_tier` y `score_breakdown.pitch_hook`
4. Agregar invariante: `SELECT COUNT(*) FROM leads WHERE passed_filter=true AND score_breakdown->>'contact_tier' IS NULL` debe ser 0

**Archivos:** `src/modules/scoring/index.ts`, nuevo `src/modules/scoring/pitch.ts`, `config/scoring.yaml`

---

### Fase 21 — PostGIS activation (infra, ~30 min, desbloquea 3 features)

**Por qué:** tenemos coordenadas GPS en prácticamente todos los leads de OSM, muchos de MINTUR y Google Places. Sin PostGIS son columnas decorativas. Con PostGIS se habilitan: competitive density (único sin web en 500m), hot zone clustering (mapa de zonas), turismo proximity (urgency signal automático). Ver `ARCHITECTURE_FUTURE.md § Sub-niche detection` y `§ Señales de valor no capturadas`.

**Implementación:**
1. Activar extensión: `CREATE EXTENSION IF NOT EXISTS postgis;` en Supabase local y cloud
2. Migrar: `ALTER TABLE leads ADD COLUMN gps geography(Point, 4326);`
3. Backfill: `UPDATE leads SET gps = ST_MakePoint(lng, lat)::geography WHERE lat IS NOT NULL AND lng IS NOT NULL;`
4. Índice: `CREATE INDEX leads_gps_gist ON leads USING GIST(gps);`
5. Agregar función `computeCompetitiveDensity(lead)` en scoring/index.ts — llama a query PostGIS y retorna tag `gap-cluster-high` o `gap-cluster-isolated`

**Verificación:** `SELECT COUNT(*) FROM leads WHERE gps IS NOT NULL;` debe ser > 3000.

---

### Fase 22 — Scoring v2 completo (reemplaza y expande Fase 19)

**Por qué:** Fase 19 parchea la fórmula actual. Fase 22 implementa la fórmula v2 completa diseñada en `ARCHITECTURE_FUTURE.md § Diseño objetivo — fórmula de scoring comercial (v2)`. El análisis de datos mostró 6 problemas concretos: leads incontactables como hot, corroboration inversamente correlacionada, niche "other" invisible, franquicias con mayor score que independientes, calidad del negocio ignorada, max() ignora multi-oferta.

**Fórmula v2:**
```
commercial_score = min(100,
  floor((gap_depth + commercial_breadth + business_quality_pts)
        × accessibility_factor × timing_factor)
  + urgency_bonus
)
```

**Componentes nuevos vs Fase 19:**
- `gap_depth` = max(sub_scores) + source_quality_bonus, cap 60 (Fase 19 ya lo tiene)
- `commercial_breadth`: bonus +8 si 2ª oferta ≥ 30, +4 si 3ª ≥ 30 — **NUEVO**
- `business_quality_pts`: rating + reviews + data_confidence + corroboration, cap 15 — **NUEVO**
- `accessibility_factor`: X=0.30, D=0.65, C=0.90, B=1.15, A=1.30, A+B=1.40 — **más agresivo que Fase 19**
- `timing_factor`: urgency + new_business + competitive_pressure + franchise_penalty — **NUEVO**
- `urgency_bonus`: high=+5, medium=+2 — **NUEVO**

**Thresholds nuevos:** hot=55 (sube de 50), pitcheable=40, pool=25.

**Archivos:** `src/modules/scoring/index.ts`, `src/modules/scoring/sub-scores.ts`, `config/scoring.yaml`

**Verificación esperada post-implementación:**
```sql
-- Leads tier X deben desaparecer de hot (< 5 excepciones permitidas)
SELECT COUNT(*) FROM leads
WHERE score_breakdown->>'contact_tier' = 'X' AND prospect_score >= 55;

-- Car dealers deben subir: avg > 40 post-v2
SELECT ROUND(AVG(prospect_score),1) FROM leads WHERE niche = 'car_dealer';

-- Franquicias deben bajar a < 20 de promedio
SELECT ROUND(AVG(prospect_score),1) FROM leads WHERE 'franchise-detected' = ANY(tags);
```

---

## API HTTP y frontend

> El sistema está compuesto por dos proyectos separados:
> - `blindspot` (este repo) — backend pipeline + API HTTP + cron
> - `blindspot-ui` (repo separado) — frontend Next.js que consume la API
>
> Ver `context/ARCHITECTURE_FUTURE.md § Arquitectura de dos proyectos` y
> `context/ARCHITECTURE_FRONTEND.md` para el diseño completo del frontend.

### Fase API — Servidor HTTP en este proyecto (prerequisito de la UI)

**Por qué:** `blindspot-ui` necesita consumir datos vía REST API. Esta capa vive en este proyecto (`src/api/`) y comparte el mismo módulo de storage y scoring. No hay lógica de negocio en el frontend.

**Prerequisitos:** Scoring v2 estable (Fase 22) + `contact_tier` y `pitch_hook` en score_breakdown.

**Implementación:**
1. `src/api/server.ts` — servidor Fastify con CORS configurado para `blindspot-ui`
2. `src/api/routes/leads.ts` — `GET /api/leads` con filtros + cursor pagination + `GET /api/leads/:id`
3. `src/api/routes/outreach.ts` — CRUD de `lead_outreach` + `POST /generate-offer`
4. `src/api/routes/discovery.ts` — CRUD de `discovery_jobs` + `GET /suggestions`
5. `src/api/routes/stats.ts` — `GET /api/stats/overview`
6. Vista `lead_dashboard` en DB (desnormalización de LeadCard sin joins)
7. `pnpm run api` — comando para iniciar el servidor API separado del CLI

**Config:** `config/api.yaml` con port, cors_origin, rate_limit, auth_token (bearer simple para primera versión).

**Archivos:** `src/api/` (directorio nuevo), `config/api.yaml` (nuevo)

**Verificación:**
```bash
curl http://localhost:3001/api/leads?contact_tier=A,B&prospect_score_gte=40&limit=5
# → array de LeadCard con todos los campos del contrato
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

### Fase 6 — Cross-source deduplication activo (BLOQUEANTE para modelo de evidencias)

**Por qué:** `findCrossSourceMatch` está implementado pero no se llama al insertar leads externos. Resultado: un mismo negocio existe como 3 leads separados en lugar de 1 lead con 3 fuentes corroborantes. `corroborating_sources` queda siempre vacío. `data_confidence_score` nunca sube. Ver `ARCHITECTURE_FUTURE.md § Cross-source como motor de confianza`.

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

**Verificación:**
```sql
-- Después de re-discovery: debe haber leads con corroborating_sources no vacío
SELECT COUNT(*) FROM leads WHERE jsonb_array_length(corroborating_sources) > 0;
```

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

### Fase 15 — Clasificación de calidad de email

**Por qué:** hoy detectamos emails pero no diferenciamos `info@dominio.com` (genérico, responde el que atiende) de `juan@dominio.com` (personal, decide el dueño). El email del dueño vale 3× para prospecting.

**Clasificación:**

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

**Archivos:** nuevo parser `src/modules/enrichment/parsers/email-quality.ts`, ajuste en `src/modules/enrichment/index.ts`.

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

---

## Proyecto frontend — blindspot-ui (repo separado)

El frontend es un proyecto Next.js separado que consume la API REST de este proyecto.
Todo el diseño de pantallas, componentes y UX está en `context/ARCHITECTURE_FRONTEND.md`.

**Prerequisitos para iniciar blindspot-ui:**
- Fase API completada (API HTTP activa en este proyecto)
- Scoring v2 estable (`contact_tier` + `pitch_hook` en score_breakdown)
- Vista `lead_dashboard` creada en DB

**Orden de construcción** (ver detalle en ARCHITECTURE_FRONTEND.md):
1. Lead Explorer básico (lista con filtros)
2. Lead Detail completo
3. Modal de registro de outreach
4. Generación de ofertas IA
5. Segment Explorer
6. Discovery Control Center

**No construir hasta que:** Fase API esté completa y se pueda hacer `curl /api/leads` y recibir datos reales.
