# Blindspot — Leads Data

> Snapshot histórico. No usar como fuente canónica de estado actual si contradice
> `PROJECT_MASTER.md § Estado de DB` o queries directas a la DB local.
> Cargar solo cuando el trabajo involucra análisis de datos, auditoría o planificación de outreach.
> Regenerar antes de tomar decisiones operativas.
> **Última actualización de este snapshot:** 2026-05-13

---

## Métricas generales

| Métrica | Valor |
|---------|-------|
| Total leads en DB | 1432 |
| passed_filter=true activos | ~170 |
| Leads hot (score ≥50) | ~26 |
| Leads pitcheables estimados | ~23-25 |
| Runs completados | 431+ |
| Costo Google Places API | ~$4 USD |

---

## Distribución por niche

| Niche | Passed | Hot ≥50 | Avg Score | Max | WA | Email |
|-------|--------|---------|-----------|-----|----|-------|
| restaurant | 100 | ~12 | 42.1 | 81 | 19 | 16 |
| hairdresser | 31 | ~8 | 42.9 | 73 | 12 | 4 |
| gym | 22 | ~5 | 41.6 | 72 | 8 | 5 |
| car_dealer | 4 | 1 | 36.3 | 63 | 1 | 2 |
| other | 6 | 0 | 37.8 | 46 | 1 | 0 |
| dentist | excluido | — | — | — | — | — |

---

## Top leads pitcheables

| Lead | Niche | Score | Canal | Ciudad | Oportunidad |
|------|-------|-------|-------|--------|-------------|
| La Nona | restaurant | 73 | pedidos@ + contabilidad@ + gerencia@ + ig | Melo | Web corporativa, estructura de empresa |
| American Fitness | gym | 72 | WhatsApp +59893512764 | Montevideo | Web desde cero |
| Lentas Maravillas | restaurant | 72 | WhatsApp | Colonia | Web, zona turística |
| Restaurante La Proa | restaurant | 72 | WA + hola@proa.uy + FB/IG | Barra de Valizas | Web, zona turística, multi-canal |
| Sorocabana | restaurant | 70 | email + domain-old-stale | Interior | Rediseño web (web de 2016) |
| Urban mood gym | gym | 68 | comercial@mood.uy + WA + FB | Montevideo | Web + integración redes |
| CLAUDIA ESTRELLA | hairdresser | 64 | WhatsApp +59895826764 | Montevideo | Redes sociales (web-only-no-social) |
| Rz.automotores | car_dealer | 63 | rz.automotores@gmail.com + WA | Montevideo | Web, FB confirmado |
| Chiviteria Sopa | restaurant | 63 | FB + IG confirmados | Interior | Web (ya tiene audiencia social) |
| De entre Casa | restaurant | 63 | deentrecasa.deco@gmail.com | Interior | Web |
| Club Atlético Sparta | gym | 57 | clubatleticosparta@gmail.com | — | Web |
| La Vieja Cocina | restaurant | 52 | WhatsApp + FB heurístico | Salto | Web |
| La Farola | restaurant | 52 | lafarolasantacruz@gmail.com | — | Rediseño (domain-old-stale) |

---

## Leads a verificar antes de contactar

| Lead | Score | Problema |
|------|-------|---------|
| Esquerré Estilistas | 68 | possible-duplicate — verificar vs Peluquería Esquerré |
| HAIRSTYLE -CONCEPT- | 62 | possible-duplicate |
| Chivitos PRO | 65 | heuristic website score 0.35 — dominio puede no ser del negocio |

---

## Rendimiento por zona geográfica

| Zona | Hot leads | Hot rate | Prioridad outreach |
|------|-----------|----------|--------------------|
| Colonia del Sacramento | 3/6 | 50% | Alta |
| Minas (Lavalleja) | 3/10 | 30% | Alta |
| Durazno | 2/9 | 22% | Alta |
| Barra de Valizas / Rocha | 2 | — | Media |
| Montevideo | scattered | ~15% | Baja (más competencia de agencias) |

---

## Pitch por segmento

| Segmento | Pitch |
|----------|-------|
| Sin website + redes confirmadas | "Ya tenés audiencia, te falta el hub central" |
| Sin website sin redes | "No existís en Google — tus clientes no te encuentran" |
| Web vieja (domain-old-stale) | "Tus clientes entran y piensan que cerraste" |
| not-responsive | "El 70% de tus visitas son mobile y tu web no funciona" |
| web-only-no-social | "Estás perdiendo clientes que buscan en Instagram" |
| Ya en redes, falta web | "Ya tenés FB/IG, dar el paso a la web es natural" |

---

## Estado de system_lists (dominios manuales)

| Valor | Lista | Razón |
|-------|-------|-------|
| factorinteractivo.com | blocked_email_domains | agencia web |
| todos.uy | blocked_email_domains | hosting compartido |
| pueblo.cine | blocked_email_domains | dominio de cine |
| cafe.uy | blocked_heuristic_domains | template compartido (auto-detected) |
| ventasweb | blocked_email_prefixes | prefijo genérico ecommerce |
| web | blocked_email_prefixes | prefijo genérico hosting |

**free_email_domains activos:** gmail.com, hotmail.com, yahoo.com, outlook.com (y variantes).
Son emails válidos del dueño — nunca bloquear, nunca limpiar.

---

## Historial de limpieza

| Acción | Afectados | Fecha |
|--------|-----------|-------|
| cafe.uy emails eliminados | 4 leads | 2026-05-12 |
| factorinteractivo, todos.uy, pueblo.cine, email@email.com eliminados | 4 leads | 2026-05-12 |
| gmail.com removido de blocked_email_domains | — (false positive) | 2026-05-13 |
| 4 leads gmail restaurados con email-found | Rz.automotores, De entre Casa, Club Atlético Sparta, La Farola | 2026-05-13 |
| 12 leads dentist → passed_filter=false | todos los dentists | 2026-05-13 |
| 4 leads tags contradictorios resueltos | Urban mood gym, CLAUDIA ESTRELLA, HAIRSTYLE CONCEPT, RESTAURANT DON DIEGO | 2026-05-13 |
| La Vieja Cocina enriquecida | score 33→52, Salto | 2026-05-13 |
| Backfill migración 009 | 1432 leads con source='google_places', external_id=place_id, source_confidence=0.90 | 2026-05-13 |
