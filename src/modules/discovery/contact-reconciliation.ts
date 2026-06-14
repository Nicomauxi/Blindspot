import type { Lead } from "../../shared/types.js";
import { nameSimilarity } from "./deduplication.js";
import { extractAddressCity } from "./geo-text.js";
import { contactKeyRefs, type ContactKeyKind } from "./contact-match.js";

export interface ContactMergeCandidate {
  primary_id: string;
  secondary_id: string;
  primary_source: string;
  secondary_source: string;
  kind: ContactKeyKind;
  key: string;
  same_city: boolean;
  name_similarity: number;
  decision: "auto" | "review";
  reason: string;
}

export interface ContactMergePlan {
  auto: ContactMergeCandidate[];
  review: ContactMergeCandidate[];
  chains: Array<{ kind: ContactKeyKind; key: string; lead_count: number }>;
}

export interface ContactMergeOpts {
  // Una clave compartida por más de este nº de leads se considera cadena/call-center
  // y nunca se auto-une (sus pares van a revisión).
  maxKeyGroupSize: number;
  // Umbral mínimo de similitud de nombre para auto-unir por dominio compartido.
  minNameSimForDomain: number;
  // IT-02: piso (bajo) de similitud de nombre para auto-unir por teléfono/email. Un
  // teléfono de gestor/contador compartido por PYMEs con nombres claramente distintos
  // ("Panadería A" vs "Ferretería B") NO debe auto-fusionar negocios diferentes.
  // Bajo a propósito: variantes legítimas cross-source ("Fcia X"/"Farmacia X") pasan.
  minNameSimForContact: number;
}

export const DEFAULT_CONTACT_MERGE_OPTS: ContactMergeOpts = {
  maxKeyGroupSize: 4,
  minNameSimForDomain: 0.35,
  // 0.45: separa gestor-phones entre negocios distintos (~0.32) de variantes legítimas
  // cross-source del mismo negocio (≥0.5, comparten el token distintivo). Ante la duda → review.
  minNameSimForContact: 0.45,
};

function leadPriority(a: Lead, b: Lead): number {
  // Menor = mejor primario. Preferimos google_places, luego mayor score/confianza.
  const googleFirst = (l: Lead): number => (l.source === "google_places" ? 0 : 1);
  if (googleFirst(a) !== googleFirst(b)) return googleFirst(a) - googleFirst(b);
  const byScore = (b.prospect_score ?? -1) - (a.prospect_score ?? -1);
  if (byScore !== 0) return byScore;
  const byConf = (b.data_confidence_score ?? -1) - (a.data_confidence_score ?? -1);
  if (byConf !== 0) return byConf;
  return a.created_at.localeCompare(b.created_at);
}

function citiesCompatible(a: Lead, b: Lead): { sameCity: boolean; known: boolean } {
  const ca = extractAddressCity(a.address);
  const cb = extractAddressCity(b.address);
  if (ca == null || cb == null) return { sameCity: false, known: false };
  return { sameCity: ca === cb, known: true };
}

function classify(
  kind: ContactKeyKind,
  primary: Lead,
  secondary: Lead,
  opts: ContactMergeOpts
): { decision: "auto" | "review"; reason: string; sameCity: boolean; nameSim: number } {
  const { sameCity, known } = citiesCompatible(primary, secondary);
  const nameSim = nameSimilarity(primary.name, secondary.name);

  // Ciudades conocidas y distintas → posible cadena/sucursal o negocios distintos → revisión.
  if (known && !sameCity) {
    return { decision: "review", reason: "city-mismatch", sameCity, nameSim };
  }

  if (kind === "phone" || kind === "email") {
    // IT-02: el mismo teléfono/email es señal fuerte, PERO si los nombres son claramente
    // distintos puede ser un número de gestor/contador compartido por negocios diferentes
    // → a revisión, no auto-fusión.
    if (nameSim < opts.minNameSimForContact) {
      return { decision: "review", reason: `shared-${kind}-low-name-sim`, sameCity, nameSim };
    }
    // Mismo teléfono/email + ciudad compatible (o desconocida) → señal fuerte de mismo negocio.
    return { decision: "auto", reason: `shared-${kind}`, sameCity, nameSim };
  }

  // kind === "domain": exigir además algo de similitud de nombre para evitar falsos.
  if (nameSim >= opts.minNameSimForDomain) {
    return { decision: "auto", reason: "shared-domain", sameCity, nameSim };
  }
  return { decision: "review", reason: "shared-domain-low-name-sim", sameCity, nameSim };
}

// Construye el plan de unión por contacto compartido entre fuentes distintas.
export function buildContactMergePlan(
  leads: Lead[],
  opts: ContactMergeOpts = DEFAULT_CONTACT_MERGE_OPTS
): ContactMergePlan {
  // Indexar leads por clave de contacto.
  const index = new Map<string, Lead[]>();
  for (const lead of leads) {
    for (const ref of contactKeyRefs(lead)) {
      const id = `${ref.kind}:${ref.key}`;
      const bucket = index.get(id);
      if (bucket) bucket.push(lead);
      else index.set(id, [lead]);
    }
  }

  const auto: ContactMergeCandidate[] = [];
  const review: ContactMergeCandidate[] = [];
  const chains: ContactMergePlan["chains"] = [];
  // Evitar duplicar el mismo par (puede compartir varias claves): nos quedamos con el más fuerte.
  const seenPairs = new Map<string, ContactMergeCandidate>();

  for (const [id, group] of index) {
    if (group.length < 2) continue;
    const sources = new Set(group.map((l) => l.source));
    if (sources.size < 2) continue; // solo cruces entre fuentes distintas

    const [kindStr, key] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    const kind = kindStr as ContactKeyKind;

    const isChain = group.length > opts.maxKeyGroupSize;
    if (isChain) chains.push({ kind, key, lead_count: group.length });

    // Primario = mejor prioridad del grupo.
    const ordered = group.slice().sort(leadPriority);
    const primary = ordered[0]!;

    for (const secondary of ordered.slice(1)) {
      if (secondary.source === primary.source) continue; // solo cross-source

      const pairKey = [primary.id, secondary.id].sort().join("|");
      let candidate: ContactMergeCandidate;

      if (isChain) {
        const { sameCity, known } = citiesCompatible(primary, secondary);
        candidate = {
          primary_id: primary.id,
          secondary_id: secondary.id,
          primary_source: primary.source,
          secondary_source: secondary.source,
          kind,
          key,
          same_city: known && sameCity,
          name_similarity: nameSimilarity(primary.name, secondary.name),
          decision: "review",
          reason: "chain-suspected",
        };
      } else {
        const c = classify(kind, primary, secondary, opts);
        candidate = {
          primary_id: primary.id,
          secondary_id: secondary.id,
          primary_source: primary.source,
          secondary_source: secondary.source,
          kind,
          key,
          same_city: c.sameCity,
          name_similarity: Number(c.nameSim.toFixed(4)),
          decision: c.decision,
          reason: c.reason,
        };
      }

      // Conservar el par más fuerte: auto > review; entre autos, phone/email > domain.
      const existing = seenPairs.get(pairKey);
      if (!existing || rank(candidate) > rank(existing)) {
        seenPairs.set(pairKey, candidate);
      }
    }
  }

  for (const candidate of seenPairs.values()) {
    (candidate.decision === "auto" ? auto : review).push(candidate);
  }

  return { auto, review, chains };
}

function rank(c: ContactMergeCandidate): number {
  if (c.decision === "auto") return c.kind === "domain" ? 2 : 3;
  return 1;
}
