// N24 — passesLeadFilter compartido. Antes vivía duplicado en routes/leads.ts y
// routes/outreach.ts, y POST /tracking solo chequeaba contact_tier: un CM restringido
// por niche/source/franquicia podía trackear (y así destapar) leads fuera de su filtro.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function passesLeadFilter(
  lead: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean {
  const tierFilter = filter["contact_tier"];
  if (Array.isArray(tierFilter) && tierFilter.length > 0) {
    const leadTier = lead["contact_tier"] as string | undefined;
    if (!leadTier || !tierFilter.includes(leadTier)) return false;
  }

  const primaryOffer = filter["primary_offer"];
  if (typeof primaryOffer === "string" && primaryOffer) {
    if (lead["primary_offer"] !== primaryOffer) return false;
  } else if (Array.isArray(primaryOffer) && primaryOffer.length > 0) {
    const leadOffer = lead["primary_offer"] as string | undefined;
    if (!leadOffer || !primaryOffer.includes(leadOffer)) return false;
  }

  const nicheFilter = filter["niche"];
  if (Array.isArray(nicheFilter) && nicheFilter.length > 0) {
    const leadNiche = lead["niche"] as string | undefined;
    if (!leadNiche || !nicheFilter.includes(leadNiche)) return false;
  }

  const sourceFilter = filter["source"];
  if (Array.isArray(sourceFilter) && sourceFilter.length > 0) {
    const leadSource = lead["source"] as string | undefined;
    if (!leadSource || !sourceFilter.includes(leadSource)) return false;
  }

  if (filter["exclude_contacted"] === true && lead["contacted_at"] != null) {
    return false;
  }

  if (
    filter["exclude_franchises"] === true &&
    Array.isArray(lead["tags"]) &&
    (lead["tags"] as unknown[]).includes("franchise-detected")
  ) {
    return false;
  }

  const requireState = filter["require_inferred_state"];
  if (isRecord(requireState)) {
    const inferredState = isRecord(lead["inferred_state"]) ? lead["inferred_state"] : null;
    const boolChecks = ["has_delivery", "has_pos", "has_reservations"] as const;
    for (const key of boolChecks) {
      if (requireState[key] === true) {
        const fieldValue = inferredState && isRecord(inferredState[key])
          ? (inferredState[key] as Record<string, unknown>)["value"]
          : null;
        if (fieldValue !== true) return false;
      }
    }
  }

  const detectedSubNiche = filter["detected_sub_niche"];
  if (Array.isArray(detectedSubNiche) && detectedSubNiche.length > 0) {
    const companyData = isRecord(lead["lead_company_data"]) ? lead["lead_company_data"] : null;
    const leadSubNiche = companyData ? asNullableString(companyData["detected_sub_niche"]) : null;
    if (!leadSubNiche || !detectedSubNiche.includes(leadSubNiche)) return false;
  }

  return true;
}
