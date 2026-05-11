import { z } from "zod";
import type { DigitalFootprint, Lead } from "../../shared/types.js";
import type {
  ParsedBreakdown,
  ProspectColor,
  ReportLeadView,
  ScoreBucket,
} from "./types.js";

// --- URL helpers ---

export function googleMapsUrl(placeId: string): string {
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
}

// --- Slug ---

export function slugify(text: string): string {
  const result = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return result || "lead";
}

// --- Score color ---

export function prospectColor(score: number | null): ProspectColor {
  if (score === null || score < 30) return "red";
  if (score < 70) return "yellow";
  return "green";
}

// --- Tags ---

export function formatTagsForDisplay(tags: string[], limit?: number): string[] {
  const filtered = tags.filter((t) => !t.startsWith("profile:"));
  return limit !== undefined ? filtered.slice(0, limit) : filtered;
}

// --- Footprint summary ---

export function summarizeFootprint(fp: DigitalFootprint | null): string {
  if (!fp) return "Sin datos de enriquecimiento.";
  if (fp.skipped) {
    return fp.reason === "no-website"
      ? "Sin website detectado."
      : "Solo presencia en redes sociales.";
  }
  if (fp.fetch_error) return `Error al acceder al sitio (${fp.fetch_error}).`;

  const parts: string[] = [];

  if (fp.stack) {
    const ver = fp.stack.version ? ` ${fp.stack.version}` : "";
    parts.push(`${fp.stack.name}${ver}`);
  }

  if (fp.pixels) {
    const hasAny =
      fp.pixels.meta_pixel?.present ||
      fp.pixels.ga4?.present ||
      fp.pixels.ga_universal?.present ||
      fp.pixels.gtm?.present;
    parts.push(hasAny ? "Con pixels de tracking" : "Sin pixels de tracking");
  }

  if (fp.whois?.age_years !== null && fp.whois?.age_years !== undefined) {
    parts.push(`Dominio de ${fp.whois.age_years} años`);
  }

  return parts.length > 0 ? parts.join(", ") + "." : "Sitio accesible.";
}

// --- Breakdown parsing ---

const BreakdownRuleSchema = z.object({
  name: z.string(),
  weight: z.number(),
  matched_value: z.unknown(),
});

const DimSchema = z.object({
  total: z.number(),
  rules: z.array(BreakdownRuleSchema),
});

const ParsedBreakdownSchema = z.object({
  computed_at: z.string(),
  config_version: z.number(),
  business_quality: DimSchema,
  digital_gap: DimSchema,
  systems_gap: DimSchema.optional(),
  prospect: z.object({ formula: z.string(), total: z.number() }),
});

export function parseScoreBreakdown(
  raw: Record<string, unknown> | null
): ParsedBreakdown | null {
  if (!raw) return null;
  const result = ParsedBreakdownSchema.safeParse(raw);
  if (!result.success) return null;
  const d = result.data;
  return {
    computed_at: d.computed_at,
    config_version: d.config_version,
    business_quality: d.business_quality,
    digital_gap: d.digital_gap,
    systems_gap: d.systems_gap ?? { total: 0, rules: [] },
    prospect: d.prospect,
  };
}

// --- Sorting ---

export function sortLeadsForReport(leads: Lead[]): Lead[] {
  return leads.slice().sort((a, b) => {
    // nulls sort after all scored leads (treat as -1 so they fall below 0)
    const sa = a.prospect_score ?? -1;
    const sb = b.prospect_score ?? -1;
    if (sb !== sa) return sb - sa;
    return a.name.localeCompare(b.name);
  });
}

// --- Buckets ---

const BUCKET_ORDER = ["70-100", "50-69", "30-49", "0-29", "no-score"] as const;

type BucketRange = (typeof BUCKET_ORDER)[number];

function rangeForScore(score: number | null): BucketRange {
  if (score === null) return "no-score";
  if (score >= 70) return "70-100";
  if (score >= 50) return "50-69";
  if (score >= 30) return "30-49";
  return "0-29";
}

const BUCKET_COLOR: Record<BucketRange, ScoreBucket["color"]> = {
  "70-100": "green",
  "50-69": "yellow",
  "30-49": "yellow",
  "0-29": "red",
  "no-score": "gray",
};

export function bucketByProspect(leads: Lead[]): ScoreBucket[] {
  const counts: Record<BucketRange, number> = {
    "70-100": 0,
    "50-69": 0,
    "30-49": 0,
    "0-29": 0,
    "no-score": 0,
  };

  for (const lead of leads) {
    counts[rangeForScore(lead.prospect_score)]++;
  }

  return BUCKET_ORDER.map((range) => ({
    range,
    count: counts[range],
    color: BUCKET_COLOR[range],
  }));
}

// --- Lead view builder ---

function displayScore(val: number | null): string {
  return val !== null ? String(val) : "—";
}

function numericAttr(val: number | null): string {
  return val !== null ? String(val) : "";
}

export function buildLeadViews(leads: Lead[]): ReportLeadView[] {
  return leads.map((lead, idx) => {
    const displayTags = formatTagsForDisplay(lead.tags, 5);
    const searchText = [lead.name, lead.address ?? "", ...displayTags]
      .join(" ")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

    return {
      rank: idx + 1,
      lead,
      color: prospectColor(lead.prospect_score),
      displayTags,
      mapsUrl: googleMapsUrl(lead.place_id),
      prospectDisplay: displayScore(lead.prospect_score),
      bqDisplay: displayScore(lead.business_quality_score),
      dgDisplay: displayScore(lead.digital_gap_score),
      sgDisplay: displayScore(lead.systems_gap_score),
      prospectVal: numericAttr(lead.prospect_score),
      bqVal: numericAttr(lead.business_quality_score),
      dgVal: numericAttr(lead.digital_gap_score),
      sgVal: numericAttr(lead.systems_gap_score),
      searchText,
      footprintSummary: summarizeFootprint(lead.digital_footprint),
      breakdown: parseScoreBreakdown(lead.score_breakdown),
      scoreless:
        lead.prospect_score === null &&
        lead.business_quality_score === null &&
        lead.digital_gap_score === null &&
        lead.systems_gap_score === null,
    };
  });
}
