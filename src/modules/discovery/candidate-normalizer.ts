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
  // N81: señales separadas — el hint estructurado (CIIU/TipoOperador/tag) es
  // autoritativo; el NOMBRE solo clasifica como último recurso ('Hotel Restaurante X'
  // con TipoOperador=hotel se reclasificaba a restaurant por la keyword del nombre).
  const hint = candidate.niche_hint?.trim() ?? "";
  const providerNiche = candidate.niche;
  const fromHint = hint ? normalizeNiche(hint, nicheAliases) : "other";

  let nicheFinal: string;
  if (fromHint !== "other") {
    nicheFinal = fromHint;
  } else if (providerNiche && providerNiche !== "other") {
    nicheFinal = providerNiche;
  } else {
    const fromName = candidate.name.trim() ? normalizeNiche(candidate.name, nicheAliases) : "other";
    nicheFinal = fromName !== "other" ? fromName : "other";
  }

  // F5.4: algunos providers ponen un email (o handle) en el campo website. Un email no es
  // una web: se mueve a `email` (si estaba vacío) y website queda null.
  let website = candidate.website;
  let email = candidate.email;
  if (website && EMAIL_RE.test(website.trim())) {
    if (!email) email = website.trim();
    website = null;
  }

  // F5.3: un phone placeholder ('0', <7 dígitos) no es un canal de contacto — anularlo
  // acá evita que cuente como contacto en qualification o como identidad en dedup.
  return { ...candidate, niche: nicheFinal, phone: scrubJunkPhone(candidate.phone), website, email };
}

const EMAIL_RE = /^[A-Za-z0-9][^\s@]*@[^\s@]+\.[^\s@]+$/;
const PLACEHOLDER_NAMES = new Set(["n/a", "na", "-", ".", ""]);

// F5.4: 'N/A', '-', vacío… no identifican un negocio — el candidate no es importable.
export function isPlaceholderName(name: string): boolean {
  return PLACEHOLDER_NAMES.has(name.trim().toLowerCase());
}

export function normalizeCandidates(
  candidates: DiscoveryCandidate[],
  nicheAliases: AllRuntime["mappings"]["nicheAliases"]
): DiscoveryCandidate[] {
  return candidates
    .filter((c) => !isPlaceholderName(c.name))
    .map((c) => normalizeCandidate(c, nicheAliases));
}
