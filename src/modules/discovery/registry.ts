import type { DiscoverySource, IDiscoveryProvider } from "../../shared/types.js";
import { EXTERNAL_DISCOVERY_SOURCES } from "../../shared/discovery-sources.js";
import { MINTURProvider } from "./providers/mintur.js";
import { OSMProvider } from "./providers/osm.js";
import { YeluProvider } from "./providers/yelu.js";
import { PedidosYaProvider } from "./providers/pedidosya.js";
import { DEIProvider } from "./providers/dei.js";

// ─── Provider registry (cableado de factories) ───────────────────────────────────
//
// Único punto donde se conectan las fuentes con su provider concreto. Importa providers
// pesados → solo lo consume el CLI/discovery, NO scoring (que usa shared/discovery-sources.ts).
// Normaliza la variación de constructores detrás de un factory(deps) uniforme.

export interface ProviderDeps {
  sleepFn: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Factories SOLO para fuentes con externalDiscovery=true (las que pasan por buildProvider).
// google_places tiene provider pero corre por su pipeline propio (no por --source).
const FACTORIES: Partial<Record<DiscoverySource, (deps: ProviderDeps) => IDiscoveryProvider>> = {
  mintur: () => new MINTURProvider(),
  osm: () => new OSMProvider(),
  yelu: (deps) => new YeluProvider({ sleepFn: deps.sleepFn }),
  pedidosya: (deps) => new PedidosYaProvider({ sleepFn: deps.sleepFn }),
  miem_dei: () => new DEIProvider(),
};

/** Construye el provider de una fuente de discovery externa. Lanza si la fuente no está cableada. */
export function buildProvider(source: string, deps: ProviderDeps = { sleepFn: defaultSleep }): IDiscoveryProvider {
  const factory = FACTORIES[source as DiscoverySource];
  if (!factory) {
    throw new Error(`Unknown provider source: ${source}`);
  }
  return factory(deps);
}

/** Fuentes con factory cableada (debe coincidir con EXTERNAL_DISCOVERY_SOURCES de la metadata). */
export const WIRED_PROVIDER_SOURCES: readonly DiscoverySource[] = Object.keys(FACTORIES) as DiscoverySource[];

/** Las fuentes que el CLI `discover-external --source` acepta. */
export const VALID_EXTERNAL_SOURCES: readonly DiscoverySource[] = EXTERNAL_DISCOVERY_SOURCES;
