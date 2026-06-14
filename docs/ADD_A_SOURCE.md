# Cómo agregar una fuente de discovery

La verdad única de las fuentes vive en **`src/shared/discovery-sources.ts`** (`DISCOVERY_SOURCE_META`).
El cableado de providers (factories) vive aparte en **`src/modules/discovery/registry.ts`** para no
acoplar scoring/tests a las dependencias pesadas de los providers (undici/cheerio/playwright).

El test **`tests/discovery/registry-consistency.test.ts`** falla indicando exactamente qué falta,
así que el flujo es: editás la metadata + (si aplica) la migración/YAML/factory, y CI te dice qué olvidaste.

## Pasos

1. **Union** — agregá el literal a `DiscoverySource` en `src/shared/types.ts`.
2. **Metadata** — agregá la entrada en `DISCOVERY_SOURCE_META` (`src/shared/discovery-sources.ts`).
   El `Record<DiscoverySource, …>` no compila si falta. Campos:
   - `sourceConfidence`: confianza base del provider (mirror del const del provider; `null` si no hay provider).
   - `scoreBonus`: `true` ⇒ DEBE tener bonus en `source_quality_bonus` de **todos** los escenarios.
   - `signalOnly`: `true` ⇒ solo corrobora, no entra como lead standalone (ej. `pedidosya`).
   - `dbConstrained`: `true` ⇒ debe estar en el CHECK de `leads` y `lead_source_references`.
   - `externalDiscovery`: `true` ⇒ se descubre por el factory genérico `discover-external --source`.
   - `cliCommand`: comando dedicado si lo tiene (si no, va por `--source`).
3. **DB** (si `dbConstrained`) — nueva migración `ADD CONSTRAINT` extendiendo el CHECK de `leads` y
   `lead_source_references` (las migraciones pasadas son inmutables; no se reescriben). Patrón:
   `supabase/migrations/20260610000000_add_miem_dei_source.sql`.
4. **Scoring** (si `scoreBonus`) — agregá la clave en el bloque `source_quality_bonus` de **cada**
   escenario de `config/scoring-calibration.yaml` (y de `config/scoring.yaml`). El valor puede variar
   por escenario; lo que se exige es la cobertura de la clave.
5. **Provider** (si tiene factory) — implementá la clase en `src/modules/discovery/providers/` (que
   implemente `IDiscoveryProvider`: `source`, `sourceConfidence`, `discover()`), y cableala en el mapa
   `FACTORIES` de `src/modules/discovery/registry.ts`. El `source`/`sourceConfidence` del provider
   deben coincidir con la metadata (el test lo verifica).
6. **CLI** — si querés un comando dedicado, agregalo en `src/cli/index.ts`; si no, `discover-external
   --source <fuente>` ya la acepta vía la metadata.

## Lo que el test verifica

- Metadata cubre exactamente el union (11 fuentes hoy).
- DB CHECK (ambas tablas) == fuentes `dbConstrained`.
- Factories cableadas == fuentes `externalDiscovery`; cada provider expone `source`/`sourceConfidence`
  iguales a la metadata.
- Cada escenario YAML cubre todas las `scoreBonus`.
- `SIGNAL_ONLY_SOURCES` derivado == las `signalOnly`.

## Fuentes en el union sin provider

`imm_habilitaciones`, `infonegocios`, `dgi` están en el union y el CHECK (placeholders para fuentes
futuras) pero no tienen provider ni `scoreBonus` aún. `social_facebook`/`social_instagram` viven solo
en `corroborating_sources` (JSON, confianza dinámica) → `dbConstrained: false`.
