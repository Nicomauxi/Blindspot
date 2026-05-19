import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildServer } from "../../api/src/server.js";

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => ({
      select: () => {
        if (table === "lead_dashboard") {
          return {
            limit: async () => ({ data: [], error: null }),
            eq: () => ({
              single: async () => ({ data: null, error: null }),
            }),
          };
        }

        return {
          eq: () => ({
            single: async () =>
              table === "pipeline_config"
                ? {
                    data: {
                      id: "singleton",
                      enabled: false,
                      cron_expression: "0 2 * * 0",
                      scheduled_for: null,
                      last_completed_at: null,
                    },
                    error: null,
                  }
                : { data: null, error: null },
          }),
          order: () => ({
            limit: () => ({
              maybeSingle: async () => ({ data: null }),
            }),
          }),
        };
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}));

describe("GET /api/v1/health", () => {
  beforeEach(() => {
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
  });

  it("returns 200 with status=ok when DB is healthy", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(body.invariants.lead_dashboard_schema_current).toBe(true);
    await app.close();
  });
});
