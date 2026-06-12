// Capa normalizadora común post-provider. Todos los datasources (yelu, osm, mintur, dei,
// foursquare, …) producen DiscoveryCandidate "crudos"; esta capa los pasa por el MISMO
// algoritmo de clasificación de niche (vocabulario dinámico + reconocimiento de palabras-nicho)
// antes del dedup/insert, preservando el `source` (origen único trazable). Así la inferencia de
// niche deja de ser ad-hoc por provider y es única para todo el pipeline.
import type { DiscoveryCandidate } from "../../shared/types.js";
import type { AllRuntime } from "../../storage/system-lists.js";
import { normalizeNiche } from "./filters.js";
import { scrubJunkPhone } from "./phone-quality.js";

// Reclasifica el niche de un candidate con el vocabulario dinámico. Usa el niche_hint crudo
// (texto de rubro/actividad que conoce el provider) y, si no, el nombre. Si el vocabulario
// devuelve algo específico lo adopta; si devuelve "other" pero el provider ya había inferido un
// niche específico, se conserva ese (no degradar la señal del provider).
export function normalizeCandidate(
  candidate: DiscoveryCandidate,
  nicheAliases: AllRuntime["mappings"]["nicheAliases"]
): DiscoveryCandidate {
  const hintText = [candidate.niche_hint, candidate.name].filter((t) => t && t.trim()).join(" ").trim();
  const classified = hintText ? normalizeNiche(hintText, nicheAliases) : "other";

  const providerNiche = candidate.niche;
  const nicheFinal =
    classified !== "other"
      ? classified
      : providerNiche && providerNiche !== "other"
        ? providerNiche
        : "other";

  // F5.3: un phone placeholder ('0', <7 dígitos) no es un canal de contacto — anularlo
  // acá evita que cuente como contacto en qualification o como identidad en dedup.
  return { ...candidate, niche: nicheFinal, phone: scrubJunkPhone(candidate.phone) };
}

export function normalizeCandidates(
  candidates: DiscoveryCandidate[],
  nicheAliases: AllRuntime["mappings"]["nicheAliases"]
): DiscoveryCandidate[] {
  return candidates.map((c) => normalizeCandidate(c, nicheAliases));
}
