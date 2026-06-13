import { describe, expect, it, vi } from "vitest";
import type { DigitalFootprint } from "../../src/shared/types.js";
import {
  appendEnrichmentChange,
  createEnrichmentDiff,
  hasCriticalEnrichmentChange,
} from "../../src/modules/enrichment/change-detection.js";

describe("createEnrichmentDiff", () => {
  it("detects website, email and delivery appearing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T16:00:00Z"));

    const previous: DigitalFootprint = {
      skipped: true,
      reason: "no-website",
      fetched_at: "2026-05-01T00:00:00Z",
      contact_emails: [],
    };
    const next: DigitalFootprint = {
      fetched_at: "2026-05-18T16:00:00Z",
      final_url: "https://negocio.uy",
      contact_emails: ["hola@negocio.uy"],
      inferred_state: {
        has_reservations: { value: false, confidence: 0.2, via: [] },
        has_delivery: { value: true, confidence: 0.95, via: ["pedidosya"] },
        has_online_catalog: { value: false, confidence: 0.2, via: [] },
        has_ecommerce: { value: false, confidence: 0.2, via: [] },
        has_pos: { value: false, confidence: 0.2, via: [] },
        has_chat_support: { value: false, confidence: 0.2, via: [] },
        digitalization_level: "basic",
        computed_at: "2026-05-18T16:00:00Z",
      },
    };

    const diff = createEnrichmentDiff("lead-1", previous, next);

    expect(diff).toEqual({
      lead_id: "lead-1",
      changed_at: "2026-05-18T16:00:00.000Z",
      changes: [
        { field: "has_website", from: false, to: true, significance: "critical" },
        { field: "contact_email", from: null, to: "hola@negocio.uy", significance: "critical" },
        { field: "inferred_state.has_delivery", from: false, to: true, significance: "critical" },
      ],
    });
  });

  it("does NOT emit has_website when only a social URL was attempted and fetch failed (FS-01)", () => {
    const previous: DigitalFootprint = {
      skipped: true,
      reason: "no-website",
      fetched_at: "2026-05-01T00:00:00Z",
      contact_emails: [],
    };
    // Fetch was attempted against a social URL but produced no real final_url.
    const next: DigitalFootprint = {
      fetched_at: "2026-05-18T16:00:00Z",
      attempted_url: "https://instagram.com/negocio",
      contact_emails: [],
    };

    expect(createEnrichmentDiff("lead-1", previous, next)).toBeNull();
  });

  it("does NOT count a social heuristic-selected URL as a website (FS-01)", () => {
    const previous: DigitalFootprint = {
      skipped: true,
      reason: "no-website",
      fetched_at: "2026-05-01T00:00:00Z",
      contact_emails: [],
    };
    const next: DigitalFootprint = {
      skipped: true,
      reason: "social-only",
      fetched_at: "2026-05-18T16:00:00Z",
      contact_emails: [],
      heuristic_discovery: {
        selected: { website: { url: "https://facebook.com/negocio", score: 0.5 } },
      },
    } as unknown as DigitalFootprint;

    expect(createEnrichmentDiff("lead-1", previous, next)).toBeNull();
  });

  it("returns null when no critical enrichment field changes", () => {
    const previous: DigitalFootprint = {
      fetched_at: "2026-05-01T00:00:00Z",
      final_url: "https://negocio.uy",
      contact_emails: ["hola@negocio.uy"],
    };
    const next: DigitalFootprint = {
      fetched_at: "2026-05-18T16:00:00Z",
      final_url: "https://negocio.uy",
      contact_emails: ["hola@negocio.uy"],
    };

    expect(createEnrichmentDiff("lead-1", previous, next)).toBeNull();
  });
});

describe("change diff helpers", () => {
  it("appends follow-up changes and reports critical significance", () => {
    const diff = appendEnrichmentChange(null, "lead-2", {
      field: "contact_tier",
      from: "C",
      to: "A",
      significance: "critical",
    });

    expect(diff.lead_id).toBe("lead-2");
    expect(diff.changes).toHaveLength(1);
    expect(hasCriticalEnrichmentChange(diff)).toBe(true);
  });
});
