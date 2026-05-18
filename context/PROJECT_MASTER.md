# Blindspot — Project Master

> Sos el Tech Lead de Blindspot. Este archivo es tu runbook operativo.
> Leé este archivo + `ROADMAP_CANONICAL.md` + `ARCHITECTURE.md` + `ARCHITECTURE_FUTURE.md` al iniciar cada sesión.
> `ROADMAP_CANONICAL.md` es la fuente canónica de orden, permisos, ownership de procesos y criterios de ejecución.
> Si la fase toca el panel admin → leer también `ADMIN_PANEL.md`.
> Si la fase toca UI → leer también `ARCHITECTURE_FRONTEND.md`.
> `LEADS_DATA.md` solo cuando el trabajo involucra análisis de datos concretos.
> Nicolás es el Product Owner + Admin del sistema — supervisa, decide y opera el panel admin. Vos ejecutás.
>
> **Señal de continuación de sesión:** si Nicolás adjunta solo este archivo (sin mensaje adicional),
> significa que quiere retomar la sesión donde quedó. Leé la sección `ESTADO DE SESIÓN` al final
> y arrancá desde la "Próxima acción" listada ahí — sin preguntar, ejecutar directamente el loop.

---

## Objetivo del producto

Blindspot es una **herramienta interna privada** que recopila información de negocios locales uruguayos desde múltiples fuentes, procesa esos datos y los rankea según el **potencial de compra** de servicios/productos. El sistema produce leads accionables con un score de probabilidad de conversión y un pitch concreto, listos para que **socios autorizados** generen ofertas automatizadas.

**No es un producto comercializable.** El sistema corre en un servidor privado, lo controla Nicolás como admin, y los socios reciben accesos delimitados (filtros, leads visibles, acciones permitidas). No hay self-registration, no hay marketing externo, no hay tier gratis/pago.

**Oportunidades que detecta el sistema (multi-oferta):**
- Presencia digital básica — sin web, sin redes, presencia mínima
- Rediseño / modernización — web vieja, no responsive, sin SEO
- Marketing y community management — redes sin actividad, sin respuesta a reviews
- Software operativo — sin punto de venta, sin gestión de stock, sin reservas online
- Catálogos y menús digitales — negocios sin carta online
- Delivery propio (escape de PedidosYa) — cuantificable en UYU/mes

**Para cada lead el sistema produce:**
- `prospect_score` (0–100) — potencial de conversión total
- `buyer_type_scores[]` — score específico por cada tipo de producto/servicio vendible (7 tipos: agencia_web, software_pos, marketing_social, delivery_propio, reservas_online, catalogo_digital, whatsapp_business)
- `primary_offer` + `pitch_hook` — la oferta más prometedora con texto concreto de apertura
- `contact_tier` (A/B/C/D/X) — qué canales de contacto están disponibles y verificados
- `data_confidence_score` + `contact_reliability_score` — fiabilidad de la información para el socio

---

## Modelo de uso

### Quién usa el sistema y cómo

| Rol | Acceso | Acciones permitidas |
|-----|--------|--------------------|
| **Admin (Nicolás)** | Total | Gestionar usuarios, configurar pipeline, disparar runs manuales, ver costos y métricas, ver/editar todos los leads, revocar accesos |
| **Socio** (CM) | Acotado por `lead_filter` configurado por admin | Ver/filtrar leads dentro de su segmento, generar ofertas, registrar outreach, ver stats propios |

**Capacidad esperada:** 2–8 socios concurrentes en horario laboral.

### Panel de administración

Ver `context/ADMIN_PANEL.md` para specs completas. Resumen:
- Gestión de socios: crear/desactivar usuarios, asignar `lead_filter`, ver actividad
- Configuración de pipeline: cron, presupuestos, fases habilitadas
- Disparo manual de runs + dry-run + abort
- Monitoreo en tiempo real de runs activos
- Dashboard de costos: Google Places API, LLM, CPU por run
- Dashboard de rendimiento: duración por fase, tasa de éxito, errores
- Discovery Control Center: cola de jobs, zonas sugeridas
- Health del sistema + restart de procesos (solo en producción)
- Audit log de acciones admin

---

## Roles

| Quién | Qué hace |
|-------|---------|
| **Nicolás** | Product Owner + Admin. Supervisa, aprueba decisiones de negocio. |
| **Socios** | Usuarios con `lead_filter` específico. Generan ofertas, registran outreach. |
| **Tech Lead (esta sesión)** | Analiza, diseña, detecta issues, **genera prompts para Claude Code**, ejecuta queries SQL de diagnóstico. **NO escribe código directamente.** |
| **Claude Code (otra sesión)** | Recibe prompt completo, implementa, verifica y reporta. |

## Modos operativos

1. **Handoff clásico (`plan master`)** — esta sesión actúa como Tech Lead y CC implementa.
2. **Ejecución directa (`single-agent`)** — el mismo agente analiza + implementa. Solo después de verificar restricciones de `SECURITY.md`, approvals y orden del roadmap.

**Regla crítica:** Tech Lead NO usa Edit/Write sobre `.ts`/`.js`/`.yaml` de código fuente. Solo `context/`.

---

## Loop de sesión

**1. Verificar estado base:**
```bash
pnpm test 2>&1 | tail -8 && pnpm typecheck 2>&1 | tail -3 && git log --oneline -3
```

**2. Verificar invariantes de calidad:**
```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "
SELECT
  COUNT(*) FILTER (WHERE passed_filter = true AND digital_footprint IS NULL) AS passed_not_enriched,
  COUNT(*) FILTER (WHERE 'no-website' = ANY(tags) AND 'website-heuristic' = ANY(tags) AND passed_filter = true) AS tags_contradictorios,
  COUNT(*) FILTER (WHERE 'email-found' = ANY(tags) AND (digital_footprint->>'contact_emails' = '[]' OR digital_footprint->>'contact_emails' IS NULL) AND passed_filter = true) AS email_found_sin_data,
  COUNT(*) FILTER (WHERE passed_filter = true AND prospect_score IS NULL) AS passed_sin_score
FROM leads;"
```

**3.** Tomar el primer item ejecutable de `ROADMAP_CANONICAL.md`.

**4.** Al cerrar sesión — reescribir ESTADO DE SESIÓN con: tests, typecheck, invariantes, próxima acción.

---

## Verificación estándar post-cambio

```bash
pnpm test 2>&1 | tail -8
pnpm typecheck 2>&1 | tail -3
git diff --name-only HEAD
```

## SQL siempre via

```bash
docker exec supabase_db_gap-radar psql -U postgres -d postgres -c "..."
```

---

## Costos

| Concepto | Valor |
|----------|-------|
| Google Places API acumulado | ~$5.16 USD |
| Crédito disponible | ~$194.84 USD (free tier $200) |

---

## Estado del roadmap — snapshot 2026-05-18

**42 de 43 items implementados y completos.** El item 43 fue descartado por razones legales.

| Bloque | Items | Estado |
|--------|-------|--------|
| 0 — Backup | Fase 49 | ✅ Completo |
| 1 — Schema aditivo | Fase 22-pre, Fase 21 | ✅ Completo |
| 2 — Migración destructiva | Fase 47 | ✅ Completo |
| 3 — Calidad de inputs | Fase 15, Fase 6A, Fase 6B | ✅ Completo |
| 4 — Scoring v2 | Fase 22-eval, Fase 22 | ✅ Completo |
| 5 — API + core automation | Fase API-0, Fase 23, Fase API | ✅ Completo |
| 6 — Operación segura | Admin MVP UI, Fase 46, Fase 48, Fase 39 | ✅ Completo |
| 7 — Outreach loop + UI base | Fase 25, Fase 44-pre, Fase 26, Fase 27, Fase 13, UI base | ✅ Completo |
| 8 — Dashboards + pipeline | Pipeline Manager UI, Discovery CC UI, Fase 24, Fase 44, Cost Dashboard, Fase 45-pre, Fase 45, Performance Dashboard, Restart Actions, Cleanup v1* | ✅ Completo (*Cleanup v1 = manual, decidido por Nicolás) |
| 9 — Enriquecimiento + refinamientos | Fase 40, Fase 28, Fase 29, Fase 11†, Fase 18†, Fase 38, Fase 37, Fase 43, Fase 36, Fase 41, Fase 42‡, Fase 30§ | ✅ Completo (excepto †‡§) |

**Excepciones Bloque 9:**
- `†` Fase 11 (IMM Habilitaciones) + Fase 18 (cruce MINTUR×IMM): bloqueadas, requieren Gemini DeepSearch del endpoint IMM. Pendiente de decisión de Nicolás.
- `‡` Fase 42 (scoring estacional): bloqueada, requiere ≥30 outreach cerrados en 2+ estaciones. Se desbloquea con operación real del sistema.
- `§` **Fase 30 (DGI dataset) — DESCARTADA PERMANENTEMENTE.** Motivo: uso de datos DGI/BPS para enriquecer base comercial propia viola la Ley 18.331 de protección de datos personales de Uruguay y las condiciones de uso de DGI. No implementar bajo ninguna circunstancia.

---

## ESTADO DE SESIÓN

> Reescribir completamente al cerrar cada sesión.

**Tests:** 1068 passing, 7 skipped, 99 files | **Typecheck:** limpio | **DB invariantes:** 0/0/0/0 (verificados 2026-05-18)

**Commits recientes:**
- `feat: implement outreach campaigns (Fase 43)` — tabla + CRUD API + UI selector
- `feat: owner_group_id detection and API (Fase 41)` — detección mismo propietario + badge UI
- `docs: AUTONOMOUS.md apunta a context/research/dgi.md para Fase 30`
- `docs: update AUTONOMOUS.md — Fases 43 + 41 completas`

**Estado del roadmap:** 42/43 items completos. Fase 30 descartada (legal). Fase 42 bloqueada (data). Fase 11 + Fase 18 bloqueadas (research IMM pendiente).

**Estado de DB (snapshot 2026-05-18 — scoring v2 aplicado):**

| Fuente | Total | Passed | Avg score |
|--------|-------|--------|-----------|
| google_places | 1474 | 172 | ~55 |
| osm | 622 | 622 | ~25 |
| yelu | 672 | 672 | ~15 |
| mintur | 2027 | 2027 | ~18 |

**Invariantes DB (post-Fase 22):**
- `passed_not_enriched`: 0 ✅
- `tags_contradictorios`: 0 ✅
- `email_found_sin_data`: 0 ✅
- `passed_sin_score`: 0 ✅
- `passed_not_v2`: 0 ✅
- `buyer_scores_not_v2`: 0 ✅

### Próxima acción

**Contexto:** se acaba de correr una auditoría lógica y funcional completa del sistema. Nicolás trae los findings del reporte de auditoría a esta sesión.

**Loop para esta sesión:**

1. Leer el reporte de auditoría que trae Nicolás
2. Por cada issue encontrado, clasificar por severidad (CRÍTICO / ALTO / MEDIO / BAJO)
3. Para issues CRÍTICO y ALTO: generar prompt para CC o ejecutar en modo directo según tamaño
4. Para issues MEDIO: evaluar si vale la pena atacarlos ahora o documentarlos como deuda técnica
5. Para issues BAJO: documentar sin ejecutar
6. Verificar con `pnpm test && pnpm typecheck` después de cada fix
7. Actualizar este ESTADO al cerrar

**Lo que NO hacer:**
- No re-implementar fases ya completas sin evidencia de que estén rotas
- No atacar Fase 30 (DGI) — descartada por legalidad, no retomar
- No atacar Fase 42 sin data de conversión real
- No instalar dependencias nuevas sin aprobación explícita

**Archivos probablemente relevantes para fixes:**
- `src/shared/types.ts` — si hay campos faltantes en tipos
- `api/src/routes/leads.ts` — si hay gaps en filtros o endpoints
- `ui/src/lib/api.ts` — si hay tipos desincronizados con la API real
- `db/migrations/` — si hay columnas en el schema que no están en la VIEW
- Los archivos que mencione el reporte de auditoría
