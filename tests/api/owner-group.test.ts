import { describe, it, expect, vi, beforeEach } from "vitest";

const LEAD_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const SIBLING_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const GROUP_ID = "cccccccc-0000-0000-0000-000000000001";
const USER_ID = "admin-user-id";

let _mockUser: Record<string, unknown> = {
  id: USER_ID,
  email: "admin@blindspot.local",
  role: "admin",
  lead_filter: null,
  active: true,
};

const mockLead = {
  id: LEAD_ID,
  name: "Restaurante A",
  niche: "restaurant",
  contact_tier: "B",
  prospect_score: 70,
  owner_group_id: GROUP_ID,
};

const mockSibling = {
  id: SIBLING_ID,
  name: "Restaurante B",
  niche: "restaurant",
  contact_tier: "B",
  prospect_score: 65,
  owner_group_id: GROUP_ID,
  score_breakdown: { contact_tier: "B" },
};

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: _mockUser, error: null }) }),
          }),
        };
      }
      if (table === "lead_dashboard") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, val: string) => ({
              single: async () => {
                if (val === LEAD_ID) return { data: mockLead, error: null };
                return { data: null, error: { code: "PGRST116" } };
              },
              neq: (_col2: string, _val2: string) =>
                Promise.resolve({ data: [mockSibling], error: null }),
            }),
          }),
        };
      }
      return {};
    },
  }),
}));

describe("GET /api/v1/leads/:id/owner-group", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";
    _mockUser = { id: USER_ID, email: "admin@blindspot.local", role: "admin", lead_filter: null, active: true };
  });

  it("returns 401 without auth", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: `/api/v1/leads/${LEAD_ID}/owner-group` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("returns 200 with sibling leads", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/leads/${LEAD_ID}/owner-group`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        id: SIBLING_ID,
        owner_group_id: GROUP_ID,
        contact_tier: "B",
      })
    );
    await app.close();
  });

  it("returns 404 for invalid UUID", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads/not-a-uuid/owner-group",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("returns 404 for unknown lead", async () => {
    const { buildServer } = await import("../../api/src/server.js");
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: USER_ID, email: "admin@blindspot.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/leads/ffffffff-ffff-ffff-ffff-ffffffffffff/owner-group",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
