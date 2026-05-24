import { describe, expect, it } from "vitest";
import {
  buildLeadFeedbackFieldOptions,
  mergeLeadFeedbackSummary,
  resolveLeadFeedbackFieldValue,
} from "../../ui/src/lib/lead-feedback";
import type { LeadDetail, LeadFeedbackEntry, LeadFeedbackSummaryEntry } from "../../ui/src/lib/api";

const lead = {
  id: "lead-1",
  name: "Parrilla Don Jorge",
  phone: "+59899123456",
  whatsapp: "+59899123456",
  email: "hola@parrilla.example.com",
  website: "https://parrilla.example.com",
  address: "18 de Julio 123",
  business_status: "OPERATIONAL",
  primary_offer: "software_pos",
  notes: "Lead prioritario",
  canonical_fields: {
    instagram: { value: "https://instagram.com/parrilla" },
  },
  field_sources: {
    website: { label: "Website", value: "https://parrilla.example.com", source: "google_places", confidence: 0.9, confirmations: 1, evidence: [] },
  },
} as unknown as LeadDetail;

describe("lead feedback helpers", () => {
  it("builds field options from lead data and canonical values", () => {
    const options = buildLeadFeedbackFieldOptions(lead);

    expect(options.some((option) => option.key === "phone" && option.value === "+59899123456")).toBe(true);
    expect(options.some((option) => option.key === "instagram" && option.value === "https://instagram.com/parrilla")).toBe(true);
  });

  it("resolves values from direct fields before canonical fallback", () => {
    expect(resolveLeadFeedbackFieldValue(lead, "website")).toBe("https://parrilla.example.com");
    expect(resolveLeadFeedbackFieldValue(lead, "instagram")).toBe("https://instagram.com/parrilla");
  });

  it("merges a newly created feedback entry into the summary", () => {
    const summary: LeadFeedbackSummaryEntry[] = [
      {
        field_key: "phone",
        total: 1,
        good_count: 1,
        bad_count: 0,
        latest_verdict: "good",
        latest_comment: "Correcto",
        latest_at: "2026-05-23T00:00:00Z",
        latest_actor_user_id: "admin-user-id",
        latest_actor_role: "admin",
      },
    ];
    const created: LeadFeedbackEntry = {
      id: "feedback-2",
      lead_id: "lead-1",
      field_key: "phone",
      field_value: "+59899123456",
      verdict: "bad",
      comment: "Tiene un dígito de más",
      actor_user_id: "cm-user-id",
      actor_role: "cm",
      created_at: "2026-05-23T01:00:00Z",
    };

    const merged = mergeLeadFeedbackSummary(summary, created);

    expect(merged).toEqual([
      expect.objectContaining({
        field_key: "phone",
        total: 2,
        good_count: 1,
        bad_count: 1,
        latest_verdict: "bad",
        latest_comment: "Tiene un dígito de más",
      }),
    ]);
  });
});
