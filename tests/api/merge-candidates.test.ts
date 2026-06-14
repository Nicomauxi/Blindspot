import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../../api/src/server.js";

process.env["API_JWT_SECRET"] = "test-secret-at-least-32-chars-long-1234";

type Row = Record<string, unknown>;

const state: {
  user: Row;
  candidates: Row[];
  leads: Row[];
  rejectResult: { data: Row | null; error: { message: string } | null };
} = {
  user: { id: "admin-id", email: "admin@test.local", role: "admin", active: true, lead_filter: null },
  candidates: [],
  leads: [],
  rejectResult: { data: { id: "mc-1" }, error: null },
};

vi.mock("../../api/src/db/client.js", () => ({
  getDb: () => ({
    from: (table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: state.user, error: null }) }) }) };
      }
      if (table === "lead_merge_candidates") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit: async () => ({ data: state.candidates, error: null }) }),
              // approve lookup: .eq("id").eq("status").single()
              eq: () => ({ single: async () => ({ data: state.candidates[0] ?? null, error: null }) }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: () => ({ select: () => ({ single: async () => state.rejectResult }) }),
            }),
          }),
        };
      }
      if (table === "leads") {
        return { select: () => ({ in: async () => ({ data: state.leads, error: null }) }) };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

function adminToken(app: Awaited<ReturnType<typeof buildServer>>): string {
  return app.jwt.sign({ user_id: "admin-id", email: "admin@test.local" });
}

describe("GET /admin/merge-candidates", () => {
  beforeEach(() => {
    state.user = { id: "admin-id", email: "admin@test.local", role: "admin", active: true, lead_filter: null };
    state.candidates = [
      { id: "mc-1", primary_lead_id: "p1", secondary_lead_id: "s1", match_kind: "phone", match_key: "099", same_city: true, name_similarity: 0.4, reason: "city-mismatch", status: "pending", created_at: "2026-06-06T00:00:00Z" },
    ];
    state.leads = [
      { id: "p1", name: "Resto A", source: "google_places", address: "x, Montevideo", phone: "099", website: null, niche: "restaurant", prospect_score: 60 },
      { id: "s1", name: "Resto A2", source: "yelu", address: "x, Montevideo", phone: "099", website: null, niche: "restaurant", prospect_score: 30 },
    ];
  });

  it("devuelve candidatos pendientes con resumen de ambos leads", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/merge-candidates",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "mc-1",
      reason: "city-mismatch",
      primary: { id: "p1", source: "google_places" },
      secondary: { id: "s1", source: "yelu" },
    });
  });

  it("omite candidatos cuyos leads ya no existen", async () => {
    state.leads = [state.leads[0]!]; // falta s1
    const app = await buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/merge-candidates",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.json().data).toHaveLength(0);
  });

  it("rechaza acceso a no-admin (cm)", async () => {
    state.user = { id: "cm-id", email: "cm@test.local", role: "cm", active: true, lead_filter: null };
    const app = await buildServer();
    const token = app.jwt.sign({ user_id: "cm-id", email: "cm@test.local" });
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/merge-candidates",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /admin/merge-candidates/:id/reject", () => {
  beforeEach(() => {
    state.user = { id: "admin-id", email: "admin@test.local", role: "admin", active: true, lead_filter: null };
    state.rejectResult = { data: { id: "mc-1" }, error: null };
  });

  it("marca el candidato como rejected", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/merge-candidates/11111111-1111-4111-8111-111111111111/reject",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("rejected");
  });

  it("404 si ya estaba resuelto", async () => {
    state.rejectResult = { data: null, error: null };
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/merge-candidates/11111111-1111-4111-8111-111111111111/reject",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400 si el id no es uuid", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/merge-candidates/not-a-uuid/reject",
      headers: { authorization: `Bearer ${adminToken(app)}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
