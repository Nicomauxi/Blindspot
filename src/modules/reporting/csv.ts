import Papa from "papaparse";
import type { DigitalFootprint, Lead } from "../../shared/types.js";
import { googleMapsUrl } from "./shared.js";

const CSV_COLUMNS = [
  "place_id",
  "name",
  "niche",
  "address",
  "phone",
  "whatsapp",
  "website",
  "heuristic_web",
  "fb_url",
  "ig_url",
  "contact_emails",
  "rating",
  "review_count",
  "business_status",
  "prospect_score",
  "business_quality_score",
  "digital_gap_score",
  "systems_gap_score",
  "tags",
  "state",
  "google_maps_url",
  "first_seen_run_id",
  "contacted_at",
] as const;

type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

function extractHeuristicWeb(fp: DigitalFootprint | null): string {
  return fp?.heuristic_discovery?.selected?.website?.url ?? "";
}

function extractFbUrl(fp: DigitalFootprint | null): string {
  if (!fp) return "";
  if (fp.social_search?.source === "duckduckgo") return fp.social_search.facebook.best_url ?? "";
  if (fp.social_search?.source === "playwright") return fp.social_search.facebook?.url ?? "";
  if (!fp.skipped) return fp.social_links?.facebook ?? "";
  return "";
}

function extractIgUrl(fp: DigitalFootprint | null): string {
  if (!fp) return "";
  if (fp.social_search?.source === "duckduckgo") return fp.social_search.instagram.best_url ?? "";
  if (fp.social_search?.source === "playwright") return fp.social_search.instagram?.url ?? "";
  if (!fp.skipped) return fp.social_links?.instagram ?? "";
  return "";
}

function leadToCsvRow(lead: Lead): CsvRow {
  const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
  const fp = lead.digital_footprint;
  return {
    place_id: lead.place_id,
    name: lead.name,
    niche: str(lead.niche),
    address: str(lead.address),
    phone: str(lead.phone),
    whatsapp: str(lead.whatsapp),
    website: str(lead.website),
    heuristic_web: extractHeuristicWeb(fp),
    fb_url: extractFbUrl(fp),
    ig_url: extractIgUrl(fp),
    contact_emails: fp?.contact_emails?.join(";") ?? "",
    rating: str(lead.rating),
    review_count: str(lead.review_count),
    business_status: str(lead.business_status),
    prospect_score: str(lead.prospect_score),
    business_quality_score: str(lead.business_quality_score),
    digital_gap_score: str(lead.digital_gap_score),
    systems_gap_score: str(lead.systems_gap_score),
    tags: lead.tags.join("|"),
    state: lead.state,
    google_maps_url: googleMapsUrl(lead.place_id),
    first_seen_run_id: str(lead.first_seen_run_id),
    contacted_at: str(lead.contacted_at),
  };
}

// N100: los valores vienen de listados scrapeados (el atacante controla el nombre de
// su propio negocio). Una celda que empieza con =, +, -, @ o TAB se evalúa como
// fórmula en Excel/Sheets (papaparse NO la neutraliza) → prefijo apóstrofo, la
// convención estándar para forzar texto plano.
const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function neutralizeFormula(value: string): string {
  return FORMULA_PREFIX_RE.test(value) ? `'${value}` : value;
}

function neutralizeRow(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = neutralizeFormula(value);
  }
  return out;
}

export function generateCsv(leads: Lead[]): string {
  const rows = leads.map((lead) => neutralizeRow(leadToCsvRow(lead)));
  const csv = Papa.unparse({ fields: [...CSV_COLUMNS], data: rows }, { quotes: true, newline: "\r\n" });
  // UTF-8 BOM prefix for Excel compatibility
  return "﻿" + csv;
}
