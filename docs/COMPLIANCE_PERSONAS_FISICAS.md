# Cumplimiento — Personas físicas (Ley 18.331)

La Ley 18.331 (protección de datos personales, Uruguay) regula el tratamiento de datos de
**personas físicas**. Una **empresa unipersonal** es legalmente la persona: su teléfono/dirección
suelen ser particulares. Por eso el pipeline **no registra ni procesa** leads que sean (probable)
persona física.

## Cómo funciona

1. **Clasificación** (`src/modules/discovery/person-classifier.ts`): `classifyLegalPersonType(name)`
   → `juridica` (forma societaria S.A./S.R.L./SAS/…), `fisica` (marcador "y otros"/"sucesión" o
   nombre completo de 3+ tokens sin palabra comercial), o `unknown`. Conservador: prioriza precisión.
2. **Gate de ingesta** (`qualifyExternalLead`): persona física → rechazo `persona-fisica` (no entra
   al pool, ni corroborada). Aplica al path externo (yelu/mintur/osm/miem_dei). **No** a
   google_places (su nombre es de Maps/marketing → la heurística es ruidosa: ~32% FP medido).
3. **Minimización** (`persona-fisica.ts` → `personaFisicaRedaction()`): al marcar persona física se
   pone `is_natural_person=true`, `passed_filter=false`, y se **anulan** los datos personales
   (phone, whatsapp, address, website, gps, source_data, digital_footprint, canonical_fields,
   inferred_state, score_breakdown, systems_gap_breakdown, notes, contact_reliability_score,
   data_confidence_score). Se conserva solo lo mínimo para reconocer el lead y NO reprocesarlo:
   `place_id`, `external_id`, `source`, `name` (NOT NULL; nombre público del directorio) y el flag.
4. **No-reprocesamiento**: `updateExistingExternalLead` y `addCorroboratingSource` cortan temprano
   si el lead es persona física; el pool de dedup (`discover-external`), el corpus de vocabulario y
   `enrich-tipo-operador` excluyen `is_natural_person` / `passed_filter=false`.

## Pasada retroactiva

`scripts/exclude-personas-fisicas.ts` (dry-run por defecto; `--apply` excluye + minimiza). Pagina
todas las fuentes externas. No imprime nombres (solo conteos). Correr con `bash scripts/backup.sh`
antes. Última corrida: 479 personas físicas minimizadas (pool → 3017).

## Limitación conocida (falsos negativos) y plan autoritativo

La heurística de nombre es un **proxy**. Falsos negativos conocidos: un unipersonal con nombre
comercial (ej. "Peluquería María") se clasifica `unknown` y permanece en el pool. Retención interina
justificada por interés comercial B2B legítimo, con tratamiento limitado al contexto de negocio.

**Resolución autoritativa planificada:** integrar el **tipo de entidad de DGI** (por RUT) para
clasificar persona física vs jurídica con certeza, reemplazando la heurística — especialmente para
el bulk de google_places, donde el nombre de Maps no es razón social. Ver `docs/ADD_A_SOURCE.md`
(el registry deja la integración de DGI en 1 paso).
