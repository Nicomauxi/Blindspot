import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/storage/leads.js", () => ({
  loadAllPassedLeads: vi.fn(),
}));

import { loadAllPassedLeads } from "../../src/storage/leads.js";
import { scoreEvalCommand } from "../../src/cli/commands/score-eval.js";

const mockLoadAllPassedLeads = loadAllPassedLeads as ReturnType<typeof vi.fn>;

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    source: "google_places",
    external_id: null,
    source_confidence: 0.9,
    source_data: null,
    data_confidence_score: null,
    contact_reliability_score: null,
    canonical_fields: null,
    corroborating_sources: [],
    lead_company_data: null,
    niche: "restaurant",
    name: "Test Business",
    address: "Montevideo",
    rating: 4.5,
    review_count: 80,
    website: null,
    whatsapp: "+59899111222",
    phone: "+59829111222",
    business_status: "OPERATIONAL",
    tags: ["no-website", "high-reviews-no-web"],
    notes: null,
    state: "discovered",
    first_seen_run_id: null,
    last_seen_run_id: null,
    google_data: {},
    digital_footprint: {
      fetched_at: "2026-01-01T00:00:00.000Z",
      contact_emails: [],
      operational_systems: {
        booking_platforms: [],
        reservation_platforms: [],
        delivery_platforms: [],
        menu_links: [],
        menu_keywords: [],
        class_booking_platforms: [],
        app_store_links: [],
        catalog_keywords: [],
        contact_form: false,
        chat_widget: false,
        ecommerce_platforms: [],
        whatsapp_web_link: false,
      },
    },
    inferred_state: null,
    gps: null,
    reviews_sample: null,
    business_quality_score: null,
    digital_gap_score: null,
    systems_gap_score: null,
    prospect_score: 45,
    scoring_version: 1,
    contact_ready: null,
    prospect_score_v1: 45,
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    score_breakdown_v1: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
});

describe("scoreEvalCommand", () => {
  it("writes the eval artifacts into the requested directory", async () => {
    mockLoadAllPassedLeads.mockResolvedValue([
      makeLead(),
      makeLead({
        id: "lead-2",
        place_id: "place-2",
        source: "mintur",
        niche: "other",
        name: "Phone Only",
        whatsapp: null,
        tags: [],
        prospect_score: 10,
      }),
    ]);

    const outDir = await mkdtemp(join(tmpdir(), "score-eval-"));

    try {
      await scoreEvalCommand({
        outputDir: outDir,
        top: 10,
        goldSetSize: 10,
      });

      const summary = await readFile(join(outDir, "summary.md"), "utf-8");
      const deltas = await readFile(join(outDir, "lead-deltas.csv"), "utf-8");
      const goldSet = await readFile(join(outDir, "gold-set.seed.csv"), "utf-8");

      expect(summary).toContain("# Fase 22-eval");
      expect(deltas).toContain("leadId");
      expect(goldSet).toContain("reviewStatus");
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
