# Blindspot — Future

> Solo contiene lo que NO está hecho todavía.
> Al completar un item → borrarlo.
> Al agregar un objetivo nuevo → insertarlo en el lugar correcto por prioridad.

---

## Urgente — Bloqueantes para el valor del producto

> Ejecutar en este orden antes de agregar providers nuevos.
> Orden: F → C

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

| Fase | Descripción | Investigación | Prioridad |
|------|-------------|---------------|-----------|
| 9 | YeluProvider — scraping yelu.uy (31k listings, confianza 0.65) | ✅ Completada | — |
| 10 | PedidosYaProvider — confirma delivery activo. Alimenta `inferred_state.has_delivery` con confianza 0.95 | ✅ Completada | — |
| 11 | IMM Habilitaciones provider — CSV Montevideo, negocios habilitados activos | pendiente | **Media** — desbloquea teléfonos para MINTUR (Fase 18) |
| 12 | InfoNegocios provider — decisores B2B, emails de gerencia | pendiente | Futuro |
| 13 | DGI provider — RUT + razón social, requiere paso de resolución a nombre comercial | pendiente | Futuro |
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

### Fase 16 — Señales de urgencia temporal

**Por qué:** no todos los gaps tienen la misma urgencia comercial. El timing del contacto importa.

**Señales a detectar:**

| Señal | Fuente | Urgencia |
|---|---|---|
| `copyright_year <= 2020` | copyright-year parser | Alta — web desactualizada visible |
| `niche IN (restaurant, hospedaje) + location IN (Punta del Este, Rocha, Cabo Polonio)` | niche + geocoords | Alta estacional — contactar antes de nov |
| `lead.created_at < 90 días` | leads.created_at | Media — negocio "nuevo en el radar" |
| `review_count < 20 AND rating >= 4.0` | google_places raw | Media — negocio joven con buena repu, en crecimiento |

**Output:** campo `urgency_signal: 'high' | 'medium' | 'low'` dentro de `score_breakdown` JSONB (no nueva columna).

**Archivos:** `src/modules/scoring/urgency.ts` (nuevo), se inyecta en `evaluator.ts`.

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
| **Schema: `inferred_state` dentro de `digital_footprint`** | Actualmente es `digital_footprint->'inferred_state'` (JSONB anidado). Difícil de indexar y consultar. Mover a columna propia `inferred_state jsonb` en `leads`. Requiere migración + actualizar todos los accesos. | Medio |
| **Schema: score columns dispersas en `leads`** | `business_quality_score`, `digital_gap_score`, `systems_gap_score`, `data_confidence_score`, `contact_reliability_score` son scores internos del pipeline en columnas sueltas. Candidatos a consolidar en `lead_buyer_scores` como tipos internos (`pipeline_bq`, `pipeline_dg`) cuando se implemente Fase 12. Evaluar junto con Fase 12. | Bajo |
| **Schema: tags como `text[]` sin confidence** | El array `tags` no puede expresar confianza por tag ni historial. Si el sistema crece en complejidad de tags, considerar `lead_tags(lead_id, tag, confidence, source, tagged_at)`. No urgente mientras tags sean booleanos. | Bajo |

---

## Visión largo plazo — UI web

Cuando el dataset sea suficientemente rico y multi-source:

**UI de inteligencia comercial:**
- Filtros por tipo de oferta: web, rediseño, marketing, software operativo, catálogos
- Filtro por `digitalization_level` (none / basic / intermediate / advanced)
- Vista de lead con `inferred_state` visible ("tiene delivery activo vía PedidosYa, confirmado")
- Evidencias por campo ("email verificado en 3 fuentes")
- Candidatos alternativos visibles (email viejo vs nuevo con su confidence)
- Reportes exportables por segmento
- Tracking de outreach integrado (contacted_at ya existe en DB)
- Filtros por zona geográfica, niche, score mínimo
- Segmento turístico MINTUR filtrable por `TipoOperador` cuando sea relevante

**No construir hasta que:** Fase B (sub-scores) y Fase F (inferred_state) estén completas, y haya al menos 3 fuentes activas produciendo datos.
