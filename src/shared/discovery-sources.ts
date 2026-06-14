import type { DiscoverySource } from "./types.js";

// ─── Discovery sources — metadata SoT (sin dependencias de providers) ─────────────
//
// Tabla única de verdad de las fuentes de discovery. Vive en shared/ y NO importa
// providers (que arrastran undici/cheerio/playwright), para que scoring y los tests de
// migraciones puedan consumirla sin acoplarse a esa cadena pesada. El cableado de factories
// vive aparte en `modules/discovery/registry.ts`.
//
// Agregar una fuente = (1) sumarla al union DiscoverySource, (2) agregar su entrada acá,
// (3) si dbConstrained: nueva migración ADD CONSTRAINT, (4) si scoreBonus: bloque en los
// escenarios YAML, (5) si tiene provider: factory en registry.ts. El test
// tests/discovery/registry-consistency.test.ts falla indicando exactamente qué falta.

export interface DiscoverySourceMeta {
  /** Confianza base del provider (mirror del const del provider; null si no hay provider). */
  readonly sourceConfidence: number | null;
  /** Ingiere leads activamente y DEBE tener bonus en source_quality_bonus (scoring). */
  readonly scoreBonus: boolean;
  /** Solo aporta como señal al corroborar otro lead (no como lead standalone). */
  readonly signalOnly: boolean;
  /** Debe estar en el CHECK de leads / lead_source_references (no para fuentes JSON-only). */
  readonly dbConstrained: boolean;
  /** Se descubre vía el factory genérico `discover-external --source` (buildProvider). */
  readonly externalDiscovery: boolean;
  /** Comando CLI dedicado, si existe (las demás van por el `--source` genérico). */
  readonly cliCommand?: string;
}

// Keyed por DiscoverySource → exhaustividad en tiempo de compilación (toda fuente del union
// DEBE tener entrada; agregar al union sin entrada acá es error de tipos).
export const DISCOVERY_SOURCE_META: Record<DiscoverySource, DiscoverySourceMeta> = {
  google_places: { sourceConfidence: 0.9, scoreBonus: true, signalOnly: false, dbConstrained: true, externalDiscovery: false, cliCommand: "discover-google-places" },
  mintur: { sourceConfidence: 0.8, scoreBonus: true, signalOnly: false, dbConstrained: true, externalDiscovery: true, cliCommand: "discover-mintur" },
  pedidosya: { sourceConfidence: 0.7, scoreBonus: true, signalOnly: true, dbConstrained: true, externalDiscovery: true },
  imm_habilitaciones: { sourceConfidence: null, scoreBonus: false, signalOnly: false, dbConstrained: true, externalDiscovery: false },
  yelu: { sourceConfidence: 0.65, scoreBonus: true, signalOnly: false, dbConstrained: true, externalDiscovery: true },
  osm: { sourceConfidence: 0.6, scoreBonus: true, signalOnly: false, dbConstrained: true, externalDiscovery: true, cliCommand: "discover-osm" },
  infonegocios: { sourceConfidence: null, scoreBonus: false, signalOnly: false, dbConstrained: true, externalDiscovery: false },
  dgi: { sourceConfidence: null, scoreBonus: false, signalOnly: false, dbConstrained: true, externalDiscovery: false },
  miem_dei: { sourceConfidence: 0.9, scoreBonus: true, signalOnly: false, dbConstrained: true, externalDiscovery: true },
  // Fuentes derivadas del scraping de la red social: confianza dinámica, viven solo en
  // corroborating_sources (JSON), no en el CHECK de las tablas.
  social_facebook: { sourceConfidence: null, scoreBonus: false, signalOnly: false, dbConstrained: false, externalDiscovery: false },
  social_instagram: { sourceConfidence: null, scoreBonus: false, signalOnly: false, dbConstrained: false, externalDiscovery: false },
};

// Enumeración en runtime del union (TS no puede enumerar un union en runtime). La
// exhaustividad se garantiza por el Record de arriba + el check de tipos de abajo.
export const ALL_DISCOVERY_SOURCES = Object.keys(DISCOVERY_SOURCE_META) as DiscoverySource[];

function metaEntries(): Array<[DiscoverySource, DiscoverySourceMeta]> {
  return Object.entries(DISCOVERY_SOURCE_META) as Array<[DiscoverySource, DiscoverySourceMeta]>;
}

// ─── Derivados (consumidos por scoring, qualification, registry, tests) ───────────

/** Fuentes que ingieren leads y DEBEN tener bonus en source_quality_bonus. */
export const ACTIVE_SCORED_SOURCES: readonly DiscoverySource[] = metaEntries()
  .filter(([, m]) => m.scoreBonus)
  .map(([s]) => s);

/** Fuentes que solo aportan como señal de corroboración (no lead standalone). */
export const SIGNAL_ONLY_SOURCES: ReadonlySet<DiscoverySource> = new Set(
  metaEntries().filter(([, m]) => m.signalOnly).map(([s]) => s)
);

/** Fuentes que deben estar en el CHECK de leads / lead_source_references. */
export const DB_CONSTRAINED_SOURCES: readonly DiscoverySource[] = metaEntries()
  .filter(([, m]) => m.dbConstrained)
  .map(([s]) => s);

/** Fuentes que se descubren vía el factory genérico (`discover-external --source`). */
export const EXTERNAL_DISCOVERY_SOURCES: readonly DiscoverySource[] = metaEntries()
  .filter(([, m]) => m.externalDiscovery)
  .map(([s]) => s);
