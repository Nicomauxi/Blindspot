import Handlebars from "handlebars";
import type { DigitalFootprint, Lead } from "../../shared/types.js";
import { slugify, formatTagsForDisplay, summarizeFootprint, parseScoreBreakdown, sortLeadsForReport } from "./shared.js";

function extractContactFields(fp: DigitalFootprint | null) {
  const heuristicWeb = fp?.heuristic_discovery?.selected?.website?.url ?? null;
  let fbUrl: string | null = null;
  let igUrl: string | null = null;
  if (fp?.social_search?.source === "duckduckgo") {
    fbUrl = fp.social_search.facebook.best_url ?? null;
    igUrl = fp.social_search.instagram.best_url ?? null;
  } else if (fp?.social_search?.source === "playwright") {
    fbUrl = fp.social_search.facebook?.url ?? null;
    igUrl = fp.social_search.instagram?.url ?? null;
  } else if (fp && !fp.skipped) {
    fbUrl = fp.social_links?.facebook ?? null;
    igUrl = fp.social_links?.instagram ?? null;
  }
  const contactEmails = fp?.contact_emails?.length ? fp.contact_emails.join("; ") : null;
  return { heuristicWeb, fbUrl, igUrl, contactEmails };
}
import { LEAD_TPL } from "./templates.js";

const compiledLead = Handlebars.compile(LEAD_TPL);

interface MdBreakdown {
  bqRules: Array<{ name: string; weight: number; matched_value: string }>;
  dgRules: Array<{ name: string; weight: number; matched_value: string }>;
  sgRules: Array<{ name: string; weight: number; matched_value: string }>;
}

function buildMdContext(lead: Lead, rank: string, runId: string) {
  const str = (v: unknown): string => (v === null || v === undefined ? "—" : String(v));
  const breakdown = parseScoreBreakdown(lead.score_breakdown);

  const mdBreakdown: MdBreakdown | null = breakdown
    ? {
        bqRules: breakdown.business_quality.rules.map((r) => ({
          name: r.name,
          weight: r.weight,
          matched_value: String(r.matched_value ?? ""),
        })),
        dgRules: breakdown.digital_gap.rules.map((r) => ({
          name: r.name,
          weight: r.weight,
          matched_value: String(r.matched_value ?? ""),
        })),
        sgRules: breakdown.systems_gap.rules.map((r) => ({
          name: r.name,
          weight: r.weight,
          matched_value: String(r.matched_value ?? ""),
        })),
      }
    : null;

  const contact = extractContactFields(lead.digital_footprint);
  return {
    rank,
    name: lead.name,
    address: str(lead.address),
    phone: str(lead.phone),
    whatsapp: str(lead.whatsapp),
    website: str(lead.website),
    heuristicWeb: contact.heuristicWeb,
    fbUrl: contact.fbUrl,
    igUrl: contact.igUrl,
    contactEmails: contact.contactEmails,
    googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(lead.place_id)}`,
    scores: {
      prospect: lead.prospect_score !== null ? String(lead.prospect_score) : "—",
      bq: lead.business_quality_score !== null ? String(lead.business_quality_score) : "—",
      dg: lead.digital_gap_score !== null ? String(lead.digital_gap_score) : "—",
      sg: lead.systems_gap_score !== null ? String(lead.systems_gap_score) : "—",
    },
    tagsJoined: formatTagsForDisplay(lead.tags).join(", ") || "—",
    breakdown: mdBreakdown,
    footprintSummary: summarizeFootprint(lead.digital_footprint),
    scoreless:
      lead.prospect_score === null &&
      lead.business_quality_score === null &&
      lead.digital_gap_score === null &&
      lead.systems_gap_score === null,
    runId,
  };
}

export function generateMdPerLead(leads: Lead[], runId = ""): Map<string, string> {
  const sorted = sortLeadsForReport(leads);
  const total = sorted.length;
  const padWidth = Math.max(2, String(total).length);
  const result = new Map<string, string>();

  for (let i = 0; i < sorted.length; i++) {
    const lead = sorted[i];
    if (!lead) continue;
    const rankStr = String(i + 1).padStart(padWidth, "0");
    const filename = `${rankStr}-${slugify(lead.name)}.md`;
    const ctx = buildMdContext(lead, rankStr, runId);
    result.set(filename, compiledLead(ctx));
  }

  return result;
}
