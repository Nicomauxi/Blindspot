import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("pipeline schema contract", () => {
  it("does not reference triggered_by_user_id outside the schema", () => {
    const route = readFileSync("api/src/routes/pipeline.ts", "utf8");
    expect(route).not.toMatch(/triggered_by_user_id/);
  });

  it("keeps pipeline_runs schema aligned with the route naming", () => {
    const migration = readFileSync("db/migrations/014_api_0_schema.sql", "utf8");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS pipeline_runs/i);
    expect(migration).toMatch(/triggered_by\s+text/i);
    expect(migration).not.toMatch(/triggered_by_user_id/i);
  });
});
