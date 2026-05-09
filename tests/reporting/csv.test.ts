import { describe, it, expect } from "vitest";
import Papa from "papaparse";
import { generateCsv } from "../../src/modules/reporting/csv.js";
import { fullScored, fbOnly, nullScore, specialChars } from "./fixtures/leads.js";

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
  "tags",
  "state",
  "google_maps_url",
  "first_seen_run_id",
  "contacted_at",
] as const;

function parseBack(csv: string) {
  // strip BOM before parsing
  const stripped = csv.startsWith("﻿") ? csv.slice(1) : csv;
  return Papa.parse<Record<string, string>>(stripped, { header: true });
}

describe("generateCsv", () => {
  it("has UTF-8 BOM as first character", () => {
    const csv = generateCsv([fullScored]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("header row matches exact column order", () => {
    const csv = generateCsv([fullScored]);
    const { meta } = parseBack(csv);
    expect(meta.fields).toEqual([...CSV_COLUMNS]);
  });

  it("produces one data row per lead", () => {
    const csv = generateCsv([fullScored, fbOnly, nullScore]);
    const { data } = parseBack(csv);
    expect(data).toHaveLength(3);
  });

  it("joins tags with pipe (|) separator", () => {
    const csv = generateCsv([fullScored]);
    const { data } = parseBack(csv);
    const row = data[0];
    expect(row?.tags).toBe("profile:a|no-website|pixel-missing|analytics-missing|whatsapp-missing");
  });

  it("renders null fields as empty strings", () => {
    const csv = generateCsv([nullScore]);
    const { data } = parseBack(csv);
    const row = data[0];
    expect(row?.prospect_score).toBe("");
    expect(row?.business_quality_score).toBe("");
    expect(row?.digital_gap_score).toBe("");
    expect(row?.website).toBe("");
    expect(row?.contacted_at).toBe("");
  });

  it("google_maps_url is built from place_id", () => {
    const csv = generateCsv([fullScored]);
    const { data } = parseBack(csv);
    expect(data[0]?.google_maps_url).toBe(
      "https://www.google.com/maps/place/?q=place_id:ChIJabcdef123"
    );
  });

  it("escapes commas and quotes in name field (specialChars)", () => {
    const withComma = { ...specialChars, name: 'Café "El Rincón", Montevideo' };
    const csv = generateCsv([withComma]);
    const { data, errors } = parseBack(csv);
    expect(errors).toHaveLength(0);
    expect(data[0]?.name).toBe('Café "El Rincón", Montevideo');
  });
});
