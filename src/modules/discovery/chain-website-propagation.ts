// B2 (parcial): propagación de dominio de empresa entre registros del mismo negocio.
//
// Problema detectado: registros como las 9 fichas de "Tienda Inglesa" no comparten
// clave de identidad (el teléfono es genérico/compartido) → detectDuplicates no los
// agrupa → el website real (tiendainglesa.com.uy) que tienen 7 fichas nunca se propaga
// a las 2 sin web, que terminan marcadas como "demanda sin web" por error.
//
// Regla SEGURA (alta precisión, validada contra el caso "La Pasiva"):
//   - Agrupar por nombre normalizado (>5 chars, evita nombres genéricos cortos).
//   - Considerar SOLO dominios web REALES (no redes sociales: una URL de IG/FB es
//     por-sucursal, un dominio .com.uy es de la empresa y vale para todas las fichas).
//   - Propagar únicamente si el grupo tiene UN dominio real dominante (>=2 fichas con
//     el mismo dominio) → a las fichas del grupo SIN ningún website.
//   - Nunca propaga si hay >1 dominio real distinto (ambigüedad) o si el único dominio
//     aparece en 1 sola ficha (puede ser un dato suelto, no la web de la empresa).

const SOCIAL_RE = /(facebook|instagram|linktr\.ee|beacons\.ai|wa\.me|whatsapp|tiktok|twitter|x\.com|linktree)/i;

export interface PropagationLead {
  id: string;
  name: string;
  website: string | null;
}

export interface WebsitePropagation {
  id: string;
  website: string;
  via_domain: string;
}

function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function extractRealDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  if (SOCIAL_RE.test(website)) return null;
  const domain = website
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .trim();
  return domain.length > 0 && domain.includes(".") ? domain : null;
}

export function computeChainWebsitePropagations(leads: PropagationLead[]): WebsitePropagation[] {
  const groups = new Map<string, PropagationLead[]>();
  for (const lead of leads) {
    const key = normalizeNameKey(lead.name);
    if (key.length <= 5) continue;
    const group = groups.get(key) ?? [];
    group.push(lead);
    groups.set(key, group);
  }

  const propagations: WebsitePropagation[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;

    // Contar dominios reales en el grupo.
    const domainCounts = new Map<string, number>();
    for (const lead of group) {
      const domain = extractRealDomain(lead.website);
      if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
    if (domainCounts.size !== 1) continue; // 0 dominios o ambigüedad → no propagar.
    const [domain, count] = [...domainCounts.entries()][0]!;
    if (count < 2) continue; // un solo dato suelto no es "la web de la empresa".

    const canonicalUrl = `https://www.${domain}/`;
    for (const lead of group) {
      const hasWebsite = lead.website != null && lead.website.trim().length > 0;
      if (!hasWebsite) {
        propagations.push({ id: lead.id, website: canonicalUrl, via_domain: domain });
      }
    }
  }
  return propagations;
}
