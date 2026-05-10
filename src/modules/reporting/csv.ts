import Papa from "papaparse";
import type { Lead } from "../../shared/types.js";
import { googleMapsUrl } from "./shared.js";

const CSV_COLUMNS = [
  "place_id",
  "name",
  "address",
  "phone",
  "whatsapp",
  "website",
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

function leadToCsvRow(lead: Lead): CsvRow {
  const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
  return {
    place_id: lead.place_id,
    name: lead.name,
    address: str(lead.address),
    phone: str(lead.phone),
    whatsapp: str(lead.whatsapp),
    website: str(lead.website),
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

export function generateCsv(leads: Lead[]): string {
  const rows = leads.map(leadToCsvRow);
  const csv = Papa.unparse({ fields: [...CSV_COLUMNS], data: rows }, { quotes: true, newline: "\r\n" });
  // UTF-8 BOM prefix for Excel compatibility
  return "﻿" + csv;
}
