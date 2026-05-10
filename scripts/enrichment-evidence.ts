/**
 * Evidence script for Phase 2 enrichment.
 *
 * Purpose: exercise the orchestrator against controlled HTML fixtures (no
 * internet access required) to demonstrate the canonical DigitalFootprint
 * shape and the official-taxonomy tags emitted by enrichment when each
 * branch is hit. This script does NOT touch Supabase — it operates entirely
 * in memory.
 *
 * Run with: pnpm tsx scripts/enrichment-evidence.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { enrichLead } from "../src/modules/enrichment/index.js";
import type { Lead } from "../src/shared/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "tests", "enrichment", "fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

function makeLead(over: Partial<Lead>): Lead {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    place_id: "ChIJevidence",
    name: "Test Lead",
    address: null,
    rating: null,
    review_count: null,
    website: "https://example.com",
    whatsapp: null,
    phone: null,
    business_status: null,
    tags: [],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: null,
    digital_footprint: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: null,
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

interface Scenario {
  title: string;
  fixture: string;
  lead: Partial<Lead>;
  whoisAgeYears: number | null;
}

const SCENARIOS: Scenario[] = [
  {
    title: "WordPress 4.9 + Meta Pixel + WhatsApp link + IG link (old domain)",
    fixture: "wordpress-pixel.html",
    lead: { name: "Salón Vintage", website: "https://salon-vintage.com.uy", phone: null },
    whoisAgeYears: 7.5,
  },
  {
    title: "Tiendanube vintage (no viewport, no analytics, no whatsapp)",
    fixture: "tiendanube-vintage.html",
    lead: { name: "Vintage Style", website: "https://vintagestyle.uy", phone: null },
    whoisAgeYears: 1.2,
  },
  {
    title: "Squarespace clean (GTM only — analytics covered by GTM)",
    fixture: "squarespace-clean.html",
    lead: { name: "Estudio Limpio", website: "https://estudio-limpio.com", phone: "+59899555000" },
    whoisAgeYears: 3.0,
  },
];

function fakeFetchHtml(html: string, finalUrl: string) {
  return async () => ({
    status: 200,
    finalUrl,
    html,
    headers: { "content-type": "text/html; charset=utf-8" },
    fetchedAt: new Date().toISOString(),
  });
}

function fakeWhois(ageYears: number | null) {
  return async () => ({
    fetched_at: new Date().toISOString(),
    created_at:
      ageYears !== null
        ? new Date(Date.now() - ageYears * 365.25 * 86_400_000).toISOString()
        : null,
    registrar: ageYears !== null ? "FAKE-REGISTRAR (evidence)" : null,
    expires_at: null,
    age_years: ageYears,
  });
}

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("ENRICHMENT EVIDENCE — Phase 2");
  console.log("Mode: HTML FIXTURES + STUBBED WHOIS (no internet access)");
  console.log("=".repeat(72));

  for (const scenario of SCENARIOS) {
    const html = loadFixture(scenario.fixture);
    const lead = makeLead(scenario.lead);
    const finalUrl = lead.website ?? "https://example.com";

    console.log("\n--- Scenario:", scenario.title);
    console.log("    Fixture: ", scenario.fixture);
    console.log("    Lead:    ", lead.name, `(${lead.website})`);
    console.log("    Whois:    age_years =", scenario.whoisAgeYears);

    const result = await enrichLead(
      lead,
      { forceRefresh: false },
      {
        fetchHtml: fakeFetchHtml(html, finalUrl),
        whoisLookup: fakeWhois(scenario.whoisAgeYears),
      }
    );

    console.log("    Outcome: ", result.outcome);
    console.log("    Tags:    ", result.tags_to_add.join(", ") || "(none)");
    console.log("    WA from site:", result.whatsapp_from_site ?? "null");
    console.log("    digital_footprint:");
    console.log(
      JSON.stringify(result.digital_footprint, null, 2)
        .split("\n")
        .map((l) => "      " + l)
        .join("\n")
    );
  }

  console.log("\n--- Edge case: lead.website = null");
  const noWeb = makeLead({ name: "Sin Web", website: null });
  const r1 = await enrichLead(noWeb, { forceRefresh: false });
  console.log("    Outcome:", r1.outcome, "→", JSON.stringify(r1.digital_footprint));

  console.log("\n--- Edge case: lead.website = facebook.com");
  const fb = makeLead({ name: "Solo FB", website: "https://www.facebook.com/x" });
  const r2 = await enrichLead(fb, { forceRefresh: false });
  console.log("    Outcome:", r2.outcome, "→", JSON.stringify(r2.digital_footprint));

  console.log("\n" + "=".repeat(72));
  console.log("DONE.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
