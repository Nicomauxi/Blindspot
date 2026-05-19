import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const VIEW_FILES = [
  "db/migrations/015_lead_dashboard_view.sql",
  "db/migrations/020_fts_search_vector.sql",
  "db/migrations/022_canonical_source.sql",
  "supabase/migrations/20260518090000_fts_search_vector.sql",
  "supabase/migrations/20260519000000_canonical_source.sql",
];

describe("lead_dashboard view contract", () => {
  it("keeps owner_group_id and score_breakdown in every current definition", () => {
    for (const file of VIEW_FILES) {
      const sql = readFileSync(file, "utf8");
      expect(sql, `${file} must expose owner_group_id`).toMatch(/owner_group_id/i);
      expect(sql, `${file} must expose score_breakdown/derived contract`).toMatch(/score_breakdown/i);
      expect(sql, `${file} must expose canonical phone field as phone`).toMatch(/\sAS phone/i);
    }
  });
});
