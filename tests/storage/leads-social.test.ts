import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabase } from "../../src/shared/supabase.js";
import { updateLeadEnrichment, updateLeadSocialSearch } from "../../src/storage/leads.js";
import type { DigitalFootprint, SocialSearch } from "../../src/shared/types.js";

vi.mock("../../src/shared/supabase.js", () => ({
  getSupabase: vi.fn(),
}));

describe("updateLeadSocialSearch", () => {
  const single = vi.fn();
  const selectEq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq: selectEq }));
  const updateEq = vi.fn();
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({ select, update }));

  beforeEach(() => {
    vi.clearAllMocks();
    updateEq.mockResolvedValue({ error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
  });

  it("merges social emails into existing contact_emails without duplicates", async () => {
    single.mockResolvedValue({
      data: {
        digital_footprint: {
          fetched_at: "2026-01-01T00:00:00.000Z",
          contact_emails: ["ventas@negocio.uy"],
        },
        tags: ["fb-heuristic"],
        whatsapp: null,
      },
      error: null,
    });
    const socialSearch: SocialSearch = {
      ran_at: "2026-01-02T00:00:00.000Z",
      source: "playwright",
      facebook: {
        url: "https://facebook.com/negocio",
        name: "Negocio",
        email: "ventas@negocio.uy",
        phone: null,
        website: null,
        description: null,
        whatsapp_button: false,
        confidence: 0.8,
        signals: ["page_loaded", "email_found"],
      },
      instagram: {
        url: "https://instagram.com/negocio",
        name: "Negocio",
        bio: "hola@negocio.uy",
        email: "hola@negocio.uy",
        phone: null,
        external_url: null,
        has_contact_button: false,
        confidence: 0.8,
        signals: ["page_loaded", "email_found"],
      },
    };

    await updateLeadSocialSearch("lead-1", socialSearch, ["fb-confirmed", "ig-confirmed"], null);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      digital_footprint: expect.objectContaining({
        social_search: socialSearch,
        contact_emails: ["ventas@negocio.uy", "hola@negocio.uy"],
      }),
      tags: expect.arrayContaining(["fb-confirmed", "ig-confirmed"]),
    }));
    expect(updateEq).toHaveBeenCalledWith("id", "lead-1");
  });

  it("adds whatsapp-derived tag when whatsapp is set and no whatsapp tag exists", async () => {
    single.mockResolvedValue({
      data: {
        digital_footprint: null,
        tags: ["profile:a"],
        whatsapp: null,
      },
      error: null,
    });
    const socialSearch: SocialSearch = {
      ran_at: "2026-01-01T00:00:00.000Z",
      source: "playwright",
      facebook: null,
      instagram: null,
    };

    await updateLeadSocialSearch("lead-2", socialSearch, [], "094123456");

    const updateCall = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Array.isArray(updateCall.tags)).toBe(true);
    expect((updateCall.tags as string[]).includes("whatsapp-derived")).toBe(true);
  });

  it("recalculates contact_reliability_score from existing contact data", async () => {
    single.mockResolvedValue({
      data: {
        digital_footprint: {
          fetched_at: "2026-01-01T00:00:00.000Z",
          contact_emails: [],
          phone_classification: [],
        },
        tags: [],
        whatsapp: null,
        phone: "+59824087679",
        canonical_fields: null,
      },
      error: null,
    });
    const socialSearch: SocialSearch = {
      ran_at: "2026-01-02T00:00:00.000Z",
      source: "playwright",
      facebook: {
        url: "https://facebook.com/negocio",
        name: "Negocio",
        email: null,
        phone: "+59898000000",
        website: null,
        description: null,
        whatsapp_button: false,
        confidence: 0.8,
        signals: ["page_loaded", "phone_found"],
      },
      instagram: null,
    };

    await updateLeadSocialSearch("lead-3", socialSearch, ["fb-confirmed"], null);

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      contact_reliability_score: 0.3,
      tags: expect.arrayContaining(["landline-phone"]),
    }));
  });
});

describe("updateLeadEnrichment — whatsapp invariant", () => {
  const single = vi.fn();
  const selectEq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq: selectEq }));
  const updateEq = vi.fn();
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({ select, update }));

  beforeEach(() => {
    vi.clearAllMocks();
    updateEq.mockResolvedValue({ error: null });
    vi.mocked(getSupabase).mockReturnValue({ from } as never);
  });

  it("adds whatsapp-derived tag when whatsapp is found on site and no whatsapp tag exists", async () => {
    single.mockResolvedValue({
      data: {
        digital_footprint: null,
        tags: ["profile:a", "no-website"],
        whatsapp: null,
      },
      error: null,
    });
    const footprint: DigitalFootprint = {
      fetched_at: "2026-01-01T00:00:00.000Z",
    };

    await updateLeadEnrichment("lead-3", footprint, [], "094999888");

    const updateCall = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Array.isArray(updateCall.tags)).toBe(true);
    expect((updateCall.tags as string[]).includes("whatsapp-derived")).toBe(true);
  });

  it("does not duplicate whatsapp-derived when tag already present", async () => {
    single.mockResolvedValue({
      data: {
        digital_footprint: null,
        tags: ["profile:a", "whatsapp-derived"],
        whatsapp: "094999888",
      },
      error: null,
    });
    const footprint: DigitalFootprint = {
      fetched_at: "2026-01-01T00:00:00.000Z",
    };

    await updateLeadEnrichment("lead-4", footprint, [], null);

    const updateCall = update.mock.calls[0]?.[0] as Record<string, unknown>;
    const tags = updateCall.tags as string[];
    expect(tags.filter((t) => t === "whatsapp-derived").length).toBe(1);
  });
});
