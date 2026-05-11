import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabase } from "../../src/shared/supabase.js";
import { updateLeadSocialSearch } from "../../src/storage/leads.js";
import type { SocialSearch } from "../../src/shared/types.js";

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
});
