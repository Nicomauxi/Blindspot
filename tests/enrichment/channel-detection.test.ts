import { describe, expect, it, vi } from "vitest";
import {
  anyMissing,
  detectConfirmedChannels,
  shouldSkip,
} from "../../src/modules/enrichment/channel-detection.js";
import type { Lead } from "../../src/shared/types.js";

vi.mock("../../src/modules/discovery/config.js", () => ({
  getDiscoveryConfig: vi.fn(() => ({
    social_domains: ["facebook.com", "instagram.com", "wa.me", "whatsapp.com"],
  })),
}));

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    place_id: "place-1",
    niche: null,
    name: "Test Business",
    address: "Av. 18 de Julio 1234, Montevideo",
    rating: null,
    review_count: null,
    website: null,
    whatsapp: null,
    phone: "099 123 456",
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
    passed_filter: true,
    rejection_reasons: [],
    score_breakdown: null,
    systems_gap_breakdown: null,
    contacted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeHeuristicDiscovery(websiteScore: number | null) {
  return {
    ran_at: "2026-01-01T00:00:00.000Z",
    mode: "full" as const,
    stale: false,
    candidates: { website: [], facebook: [], instagram: [], whatsapp: [] },
    selected: {
      website: websiteScore !== null
        ? { kind: "website" as const, url: "https://example.com.uy", score: websiteScore, signals: [], status: "probed" as const }
        : null,
      facebook: null,
      instagram: null,
      whatsapp: null,
    },
  };
}

describe("detectConfirmedChannels — facebook", () => {
  it("fb-confirmed tag → confirmed", () => {
    const lead = makeLead({ tags: ["fb-confirmed"] });
    expect(detectConfirmedChannels(lead).facebook.decision).toBe("confirmed");
  });

  it("fb-heuristic tag → heuristic", () => {
    const lead = makeLead({ tags: ["fb-heuristic"] });
    expect(detectConfirmedChannels(lead).facebook.decision).toBe("heuristic");
  });

  it("no fb tag → missing", () => {
    const lead = makeLead({ tags: [] });
    expect(detectConfirmedChannels(lead).facebook.decision).toBe("missing");
  });
});

describe("detectConfirmedChannels — instagram", () => {
  it("ig-confirmed tag → confirmed", () => {
    const lead = makeLead({ tags: ["ig-confirmed"] });
    expect(detectConfirmedChannels(lead).instagram.decision).toBe("confirmed");
  });

  it("ig-heuristic tag → heuristic", () => {
    const lead = makeLead({ tags: ["ig-heuristic"] });
    expect(detectConfirmedChannels(lead).instagram.decision).toBe("heuristic");
  });

  it("no ig tag → missing", () => {
    const lead = makeLead({ tags: [] });
    expect(detectConfirmedChannels(lead).instagram.decision).toBe("missing");
  });
});

describe("detectConfirmedChannels — whatsapp", () => {
  it("whatsapp-confirmed tag → confirmed", () => {
    const lead = makeLead({ tags: ["whatsapp-confirmed"] });
    expect(detectConfirmedChannels(lead).whatsapp.decision).toBe("confirmed");
  });

  it("whatsapp-derived tag → heuristic", () => {
    const lead = makeLead({ tags: ["whatsapp-derived"] });
    expect(detectConfirmedChannels(lead).whatsapp.decision).toBe("heuristic");
  });

  it("no whatsapp tag → missing", () => {
    const lead = makeLead({ tags: [] });
    expect(detectConfirmedChannels(lead).whatsapp.decision).toBe("missing");
  });
});

describe("detectConfirmedChannels — website", () => {
  it("real non-social website from Google Places → confirmed", () => {
    const lead = makeLead({ website: "https://mitienda.com.uy" });
    expect(detectConfirmedChannels(lead).website.decision).toBe("confirmed");
  });

  it("social URL as website → not confirmed, check tags", () => {
    const lead = makeLead({ website: "https://facebook.com/mitienda" });
    expect(detectConfirmedChannels(lead).website.decision).toBe("missing");
  });

  it("website-heuristic tag + score >= 0.7 → confirmed", () => {
    const lead = makeLead({
      tags: ["website-heuristic"],
      digital_footprint: {
        skipped: false,
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: makeHeuristicDiscovery(0.75),
      },
    });
    expect(detectConfirmedChannels(lead).website.decision).toBe("confirmed");
  });

  it("website-heuristic tag + score exactly 0.7 → confirmed", () => {
    const lead = makeLead({
      tags: ["website-heuristic"],
      digital_footprint: {
        skipped: false,
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: makeHeuristicDiscovery(0.7),
      },
    });
    expect(detectConfirmedChannels(lead).website.decision).toBe("confirmed");
  });

  it("website-heuristic tag + score < 0.7 → heuristic", () => {
    const lead = makeLead({
      tags: ["website-heuristic"],
      digital_footprint: {
        skipped: false,
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: makeHeuristicDiscovery(0.5),
      },
    });
    expect(detectConfirmedChannels(lead).website.decision).toBe("heuristic");
  });

  it("website-heuristic tag + no score in footprint → heuristic", () => {
    const lead = makeLead({
      tags: ["website-heuristic"],
      digital_footprint: null,
    });
    expect(detectConfirmedChannels(lead).website.decision).toBe("heuristic");
  });

  it("website-heuristic tag + selected website is null → heuristic", () => {
    const lead = makeLead({
      tags: ["website-heuristic"],
      digital_footprint: {
        skipped: false,
        fetched_at: "2026-01-01T00:00:00.000Z",
        heuristic_discovery: makeHeuristicDiscovery(null),
      },
    });
    expect(detectConfirmedChannels(lead).website.decision).toBe("heuristic");
  });

  it("no website, no tags → missing", () => {
    const lead = makeLead({ tags: [] });
    expect(detectConfirmedChannels(lead).website.decision).toBe("missing");
  });
});

describe("detectConfirmedChannels — email", () => {
  it("always returns missing regardless of contact_emails", () => {
    const leadNoEmails = makeLead({ digital_footprint: null });
    const leadWithEmails = makeLead({
      digital_footprint: {
        skipped: false,
        fetched_at: "2026-01-01T00:00:00.000Z",
        contact_emails: ["info@example.com", "ventas@example.com"],
      },
    });
    expect(detectConfirmedChannels(leadNoEmails).email.decision).toBe("missing");
    expect(detectConfirmedChannels(leadWithEmails).email.decision).toBe("missing");
  });
});

describe("shouldSkip", () => {
  it("returns true for confirmed", () => {
    expect(shouldSkip({ decision: "confirmed" })).toBe(true);
  });

  it("returns false for heuristic", () => {
    expect(shouldSkip({ decision: "heuristic" })).toBe(false);
  });

  it("returns false for missing", () => {
    expect(shouldSkip({ decision: "missing" })).toBe(false);
  });
});

describe("anyMissing", () => {
  it("returns false when all channels are confirmed", () => {
    const allConfirmed = {
      website:   { decision: "confirmed" as const },
      facebook:  { decision: "confirmed" as const },
      instagram: { decision: "confirmed" as const },
      whatsapp:  { decision: "confirmed" as const },
      email:     { decision: "confirmed" as const },
    };
    expect(anyMissing(allConfirmed)).toBe(false);
  });

  it("returns true when one channel is heuristic", () => {
    const ch = {
      website:   { decision: "confirmed" as const },
      facebook:  { decision: "heuristic" as const },
      instagram: { decision: "confirmed" as const },
      whatsapp:  { decision: "confirmed" as const },
      email:     { decision: "confirmed" as const },
    };
    expect(anyMissing(ch)).toBe(true);
  });

  it("returns true when one channel is missing", () => {
    const ch = {
      website:   { decision: "confirmed" as const },
      facebook:  { decision: "confirmed" as const },
      instagram: { decision: "missing" as const },
      whatsapp:  { decision: "confirmed" as const },
      email:     { decision: "confirmed" as const },
    };
    expect(anyMissing(ch)).toBe(true);
  });
});
