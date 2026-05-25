# LEAD-5 — Auditoría triple: Ficha de Lead

**Fecha:** 2026-05-25  
**Rama:** feature/mejoras  
**Archivos auditados:** `ui/src/app/admin/leads/[id]/page.tsx`, `commercial-summary.tsx`, `contact-block.tsx`, `collapsible-section.tsx`, `ui/src/lib/api.ts`

---

## Audit 1 — Técnica

### PASS
- Contratos de tipo UI/API sólidos: todos los campos accedidos en `lead` están declarados en `LeadDetail` / `LeadDashboard`.
- `ContactPoint` exportado desde `contact-block.tsx`, importado correctamente en `page.tsx`.
- `useMemo` deps en `actionChecklist` usan `.length` en lugar del array — optimización deliberada y correcta.
- Sin `any` en página ni componentes; se usa `unknown` en `StructuredValue` y `buildContactPoints`.
- `CommercialSummary` recibe `evidenceTree={lead.commercial_evidence_tree ?? []}` con default `[]` en la prop — contrato sólido.
- `CollapsibleSection` tiene guard SSR para `sessionStorage`.
- `handleContactFeedback` captura `token` y `lead` correctamente sin closures obsoletas.

### Problemas encontrados

| Sev | Problema | Archivo:línea | Fix aplicado |
|-----|----------|---------------|--------------|
| HIGH | `useEffect` del assistant brief tiene `lead` como dep — se re-dispara en cada `setLead()` después de unlock de contacto, generando llamadas LLM innecesarias | `page.tsx:107` | Usar `lead?.id` en lugar de `lead` |
| HIGH | `visit()` en `buildContactPoints` no tiene límite de profundidad — payload malformado podría causar stack overflow | `page.tsx:~751` | Agregar `depth = 0` + guard `if (depth > 10) return` |
| MEDIUM | `navigator.clipboard.writeText()` no tiene `.catch()` — falla silenciosamente en contextos no-HTTPS | `page.tsx:~215` | Agregar `.catch()` |
| MEDIUM | `StructuredValue` usa `index` como key en arrays read-only | `page.tsx:~812` | Riesgo bajo, aceptado |
| MEDIUM | `OutreachRow` define `statusColor` como const local en cada render | `page.tsx:~654` | Hoistar a nivel módulo |
| MEDIUM | `commercial-summary.tsx` usa `idx` como key para `signals` | `commercial-summary.tsx:103` | Usar `signal.label` |
| LOW | `STATUS_COLORS` definido pero nunca usado en la página | `page.tsx:37` | Eliminar |
| LOW | `OFFERING_EVIDENCE_KEYS` cubre solo 5 IDs — offers futuros caen al default silenciosamente | `commercial-summary.tsx:36` | Aceptado |
| LOW | `formatSectionError` con `assistant_unavailable` se aplica también a errores de offer | `page.tsx:55` | Riesgo bajo |

---

## Audit 2 — UX

### PASS
- Jerarquía visual correcta: StatCards → Análisis comercial → Contacto → Historial (colapsado) → Diagnóstico (colapsado).
- Collapsibles defaultOpen=false para secciones técnicas — vista inicial limpia.
- Estados de loading con skeleton para assistant brief (evita layout shift).
- Banner RBAC para unlock de contacto `cm` prominente y accionable.
- `ContactBlock` con `max-h-[480px] overflow-y-auto` previene dominancia del scroll.
- `FilterChip` con `type="button"`.
- `CollapsibleSection` con `aria-expanded={isOpen}`.

### Problemas encontrados

| Sev | Problema | Archivo:línea | Fix aplicado |
|-----|----------|---------------|--------------|
| HIGH | Footer duplica "Iniciar seguimiento" sin diferenciación — puede confundir después del primer tracking | `page.tsx:~531` | Cambiar a "Ver en CRM" cuando hay trackingNotice |
| HIGH | `<select>` de canal no se deshabilita durante `offerLoading` — puede crear mismatch canal/resultado | `page.tsx:~420` | Agregar `disabled={offerLoading}` |
| MEDIUM | No hay retry action cuando el assistant brief falla | `page.tsx:~305` | Aceptado — workaround via offer generator |
| MEDIUM | `<select>` canal sin `<label>` — no accesible por screen reader | `page.tsx:~420` | Agregar `<label htmlFor>` |
| MEDIUM | Botones de acción (header, footer) sin `type="button"` | `page.tsx:~235,239,528,531` | Agregar `type="button"` |
| MEDIUM | Tarjeta "Estado operativo" (dark slate-950) en sección comercial distrae con peso visual | `page.tsx:~343` | Aceptado — informativa |
| LOW | Footer aparece antes del "Mismo propietario" en scroll — leve ruptura de flujo visual | layout | Aceptado |
| LOW | `<details>` / `<summary>` nativos en StructuredSection sin aria-label | `page.tsx:~682` | Riesgo bajo |

---

## Audit 3 — Comercial (simulación flujo vendedor)

### Flujo simulado: Vendedor recibe un lead nuevo y abre la ficha

**¿QUIÉN es el lead? (< 30 seg)**  
PASS. Nombre en el H1 del `AdminPageLayout`. Las 5 StatCards dan tier, score, oferta primaria y estado de contacto en 5–10 segundos.

**¿QUÉ venderle?**  
PASS con caveat. `CommercialSummary` es lo primero después de StatCards. El pitch de entrada (verde) es visualmente prominente. Caveat: cuando `assistant` es null, el pitch box desaparece y el vendedor ve grillas técnicas de SourceFieldCards.

| Sev | Problema | Fix aplicado |
|-----|----------|--------------|
| MEDIUM | Cuando `assistant` es null y `lead.pitch_hook` existe, no hay pitch de respaldo visible | Agregar bloque pitch_hook cuando assistant falla |

**¿CÓMO contactarlo?**  
PASS con fricción. `ContactBlock` tiene botones de acción directos. Para `cm` con contacto redactado, el banner de unlock está visible pero separado del `ContactBlock` vacío.

| Sev | Problema | Fix aplicado |
|-----|----------|--------------|
| MEDIUM | Cuando contacto está redactado, el `ContactBlock` muestra empty state mientras la acción de unlock está más arriba — desconexión de contexto | Aceptado por ahora |

**¿CUÁL es el próximo paso?**  
PASS. "Qué hacer ahora" visible en columna derecha sin scroll en desktop. Checklist de 5 ítems bien diseñado.

**¿Hay ruido técnico innecesario en vista default?**  
PASS. Todo lo técnico está colapsado por defecto (dos niveles). Vista default es 100% comercial.

---

## Resumen ejecutivo

| Severidad | Total | Aplicados | Pendientes |
|-----------|-------|-----------|------------|
| CRITICAL  | 0     | —         | —          |
| HIGH      | 4     | 4         | 0          |
| MEDIUM    | 9     | 3         | 6 (aceptados o bajo impacto) |
| LOW       | 6     | 0         | 6 (todos aceptados) |

**Veredicto: APROBADO con advertencias resueltas.** Los 4 issues HIGH fueron corregidos en el mismo PR.
