# Blindspot — Future

> Solo contiene lo que NO está hecho todavía.
> Al completar un item → borrarlo.
> Al agregar un objetivo nuevo → insertarlo en el lugar correcto por prioridad.

---

## En curso — Arquitectura multi-source

> Las fases con fuente externa tienen su investigación en `context/research/<fuente>.md`.
> Antes de implementar una fase sin MD → correr Gemini DeepSearch primero (ver flujo en PROJECT_MASTER.md).

| Fase | Descripción | Investigación | Prioridad |
|------|-------------|---------------|-----------|
| 8 | OSMProvider via Overpass API — gratuito, GPS nativo, cubre interior del país | [osm.md](research/osm.md) | Media |
| 9 | YeluProvider — refactor desde directory-discovery.ts existente | pendiente | Media |
| 10 | PedidosYaProvider — confirma negocio operativo, datos de menú y horarios | pendiente | Media |
| 11 | IMM Habilitaciones provider — CSV Montevideo, negocios habilitados activos | pendiente | Baja |
| 12 | InfoNegocios provider — decisores B2B, emails de gerencia | pendiente | Futuro |
| 13 | DGI provider — RUT + razón social, requiere paso de resolución a nombre comercial | pendiente | Futuro |

---

## Mejoras de scoring

| Item | Descripción | Prioridad |
|------|-------------|-----------|
| Rating + review_count como multiplicadores | 4.8★/200 reviews ≠ 4.1★/12. Multiplicador 1.0×–1.5× sobre prospect_score | Media |
| Scoring por tipo de oferta | Calcular sub-scores específicos por oportunidad: web, marketing, software, etc. Usa señales ya capturadas (ver ARCHITECTURE.md sección señales) | Media |
| Bonus corroboración cross-source | Dato confirmado en 2+ fuentes sube confidence. Bloquea Fase 4 | Media |
| Zona turística como urgencia | Colonia, Barra de Valizas, Cabo Polonio = multiplicador de urgencia en pitch | Baja |

---

## Captura de señales nuevas

Señales que el producto necesita para clasificar oportunidades más allá de presencia digital:

| Señal | Cómo capturarla | Para qué oferta |
|-------|----------------|----------------|
| ¿Tiene menú/carta online? | Heurístico en web del negocio | Catálogo digital, punto de venta |
| ¿Tiene sistema de reservas? | Heurístico + operational_systems | Software de gestión |
| ¿Responde reviews en Google? | google_data ya lo tiene | Receptividad digital, community mgmt |
| Cantidad de empleados aproximada | BPS futuro / tamaño local | Qué software tiene sentido vender |
| Antigüedad del negocio | WHOIS ya lo hace para web; MINTUR/DGI para el negocio | Estabilidad, presupuesto probable |
| ¿Tiene fotos en Google Maps? | google_data ya lo tiene | Completitud de perfil, calidad percibida |

---

## Discovery pendiente

Ejecutar solo después de confirmar invariantes en 0.

| Acción | Perfil | Prioridad |
|--------|--------|-----------|
| Colonia del Sacramento — restaurant + hospedaje | A/B | Alta |
| Minas (Lavalleja) — restaurant + gym | A/B | Alta |
| Durazno — restaurant + car_dealer | A/B | Alta |
| Barra de Valizas / Rocha — restaurant | A | Media |
| Salto — restaurant (La Vieja Cocina mostró potencial) | A/B | Media |

---

## Deuda técnica

| Item | Descripción | Impacto |
|------|-------------|---------|
| `enrichment/index.ts` grande | Refactor en módulos más pequeños | Bajo |
| `whois.ts` sin tests | Hace I/O de red, falla silenciosa si formato cambia | Bajo |
| Fase F — eliminar fallbacks hardcodeados | Post magic-lists completo | Medio |
| Phone regex unificada `shared/phone.ts` | Lógica de validación de teléfonos dispersa en varios parsers | Medio |
| `web-outdated` undercounting | copyright-year parser falla en sitios sin copyright visible | Bajo |

---

## Visión largo plazo — UI web

Cuando el dataset sea suficientemente rico y multi-source:

**UI de inteligencia comercial:**
- Filtros por tipo de oferta: web, marketing, software operativo, community management
- Vista de lead con evidencias por campo ("email verificado en 3 fuentes")
- Candidatos alternativos visibles (email viejo vs nuevo con su confidence)
- Reportes exportables por segmento
- Tracking de outreach integrado (contacted_at ya existe en DB)
- Filtros por zona geográfica, niche, score mínimo

**No construir hasta que:** arquitectura multi-source esté completa (Fase 6+) y haya al menos 3 fuentes activas produciendo datos.
